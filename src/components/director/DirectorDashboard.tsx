import React, { useMemo, useState, useEffect } from 'react';

import * as XLSX from 'xlsx';

import jsPDF from 'jspdf';

import type { Club, ClubMembership, DirectorReport, Expense, User } from '../../types';

import { generateDirectorPDFReport, generateSHA256 } from '../../lib/pdfGenerator';

import { ReportVerificationModal } from './ReportVerificationModal';

import { QRCodeExpenseScanner } from '../common/QRCodeExpenseScanner';

import { LaunchExpenseModal } from '../scaer/LaunchExpenseModal';

import {

  FileCheck,

  Download,

  QrCode,

  Search,

  Users,

  Receipt,

  FileSpreadsheet,

  FileText,

  PlusCircle,

  Trash2,

  CheckCircle2,

  Filter,

  DollarSign,

  ChevronDown,

  ChevronRight,

  Calendar,

  Layers,

  ArrowUpDown,

  Store,

} from 'lucide-react';

import { DatabaseService } from '../../lib/pocketbase';

import { EventCompanyRegistration } from './EventCompanyRegistration';

import { LaunchEventExpenseModal } from './LaunchEventExpenseModal';

import { EventLaunchQuery } from './EventLaunchQuery';



interface DirectorDashboardProps {

  directorUser: User;

  allUsers?: User[];

  expenses: Expense[];

  clubs: Club[];

  memberships: ClubMembership[];

  reports: DirectorReport[];

  onSaveReport: (report: Omit<DirectorReport, 'id'>) => Promise<DirectorReport>;

  theme?: 'dark' | 'light';

  onRefreshData?: () => void;

}



interface CadetMonthlyExtractItem {

  id: string;

  cadetNumber: string;

  warName: string;

  fullName: string;

  squadron: string;

  expensesCount: number;

  totalAmount: number;

  expenses: Expense[];

}



export const DirectorDashboard: React.FC<DirectorDashboardProps> = ({

  directorUser,

  allUsers = [],

  expenses,

  clubs,

  memberships,

  reports,

  onSaveReport,

  theme = 'dark',

  onRefreshData,

}) => {

  const [directorSubTab, setDirectorSubTab] = useState<'extrato' | 'repasse' | 'members' | 'audit' | 'events' | 'event_query'>('extrato');



    const getInitialDirectorPeriod = (): string => {

    try {

      const saved = localStorage.getItem('cedula_director_selected_period');

      if (saved) return saved;

    } catch {}

    const now = new Date();

    // Mês seguinte ao mês atual (ex: Nov/2026 -> Dez/2026)

    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const yr = nextMonth.getFullYear();

    const mo = String(nextMonth.getMonth() + 1).padStart(2, '0');

    return `${yr}-${mo}`;

  };



  const [selectedPeriod, setSelectedPeriodState] = useState<string>(getInitialDirectorPeriod);



  const setSelectedPeriod = (period: string) => {

    setSelectedPeriodState(period);

    try {

      localStorage.setItem('cedula_director_selected_period', period);

    } catch {}

  };



  // Transações do período carregadas dinamicamente

  const [periodExpenses, setPeriodExpenses] = useState<Expense[]>(

    expenses.filter((e) => selectedPeriod === 'all' || e.billingPeriod === selectedPeriod)

  );



  useEffect(() => {

    let isMounted = true;

    const fetchTxs = async () => {

      if (selectedPeriod === 'all') {

        setPeriodExpenses(expenses);

        return;

      }

      try {

        const txs = await DatabaseService.getTransactionsByPeriod(selectedPeriod);

        if (isMounted) {

          setPeriodExpenses(txs as unknown as Expense[]);

        }

      } catch (err) {

        console.error('Erro ao buscar transações do período na Diretoria:', err);

        if (isMounted) {

          setPeriodExpenses(expenses.filter((e) => e.billingPeriod === selectedPeriod));

        }

      }

    };



    fetchTxs();

    return () => {

      isMounted = false;

    };

  }, [selectedPeriod, expenses]);



  // --- ABA 1: EXTRATO DO MÊS (POR CADETE) ---

  const [extratoSearchQuery, setExtratoSearchQuery] = useState<string>('');

  const [extratoSquadronFilter, setExtratoSquadronFilter] = useState<string>('all');

  const [extratoPage, setExtratoPage] = useState<number>(1);

  const [expandedCadets, setExpandedCadets] = useState<Set<string>>(new Set());



  // --- ABA 2: REPASSE AOS CLUBES ---

  const [repasseSearchTerm, setRepasseSearchTerm] = useState<string>('');



  // --- ABA 3: SÓCIOS DOS CLUBES ---

  const [memberClubFilter, setMemberClubFilter] = useState<string>('all');

  const [memberSearchQuery, setMemberSearchQuery] = useState<string>('');

  const [memberPage, setMemberPage] = useState<number>(1);



  // --- ABA 4: LANÇAMENTOS DETALHADOS (AUDITORIA) ---

  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');

  const [auditClubFilter, setAuditClubFilter] = useState<string>('all');

  const [auditPage, setAuditPage] = useState<number>(1);



  // Modais e Estados de Execução

  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  const [showVerifyModal, setShowVerifyModal] = useState<boolean>(false);

  const [showQrScanner, setShowQrScanner] = useState<boolean>(false);

  const [showLaunchModal, setShowLaunchModal] = useState<boolean>(false);

  const [showEventLaunchModal, setShowEventLaunchModal] = useState<boolean>(false);

  const [scannedCadetInfo, setScannedCadetInfo] = useState<{ cadetNumber: string; warName?: string } | null>(null);



  const isDark = theme === 'dark';



  // --- CONSTRUÇÃO DO EXTRATO DO MÊS POR CADETE A PARTIR DOS USUÁRIOS REAIS DO POCKETBASE ---

  const cadetMonthlyList: CadetMonthlyExtractItem[] = useMemo(() => {

    const baseCadets = allUsers.length > 0

      ? allUsers.filter((u) => u.role === 'cadete' || u.role === 'diretor' || !u.role)

      : [];



    const itemsMap = new Map<string, CadetMonthlyExtractItem>();

    const lookupMap = new Map<string, CadetMonthlyExtractItem>();



    baseCadets.forEach((u) => {

      const cleanNum = (u.cadetNumber || '').replace(/\D/g, '');

      const fmtNum = cleanNum.length === 5 ? `${cleanNum.slice(0, 2)}/${cleanNum.slice(2)}` : (u.cadetNumber || '---');

      const itemKey = cleanNum || u.id;



      const item: CadetMonthlyExtractItem = {

        id: u.id,

        cadetNumber: fmtNum,

        warName: u.warName || u.name || 'CADETE',

        fullName: u.name || u.warName || 'Cadete AFA',

        squadron: u.squadron || '1º Esquadrão',

        expensesCount: 0,

        totalAmount: 0,

        expenses: [],

      };



      itemsMap.set(itemKey, item);

      lookupMap.set(u.id, item);

      if (u.cadetNumber) lookupMap.set(u.cadetNumber, item);

      if (cleanNum) lookupMap.set(cleanNum, item);

      if (fmtNum) lookupMap.set(fmtNum, item);

    });



    periodExpenses.forEach((exp) => {

      const expCleanNum = (exp.cadetNumber || '').replace(/\D/g, '');

      const expFmtNum = expCleanNum.length === 5 ? `${expCleanNum.slice(0, 2)}/${expCleanNum.slice(2)}` : exp.cadetNumber;

      

      const matched =

        (exp.userId ? lookupMap.get(exp.userId) : null) ||

        (exp.cadetId ? lookupMap.get(exp.cadetId) : null) ||

        (expCleanNum ? lookupMap.get(expCleanNum) : null) ||

        (expFmtNum ? lookupMap.get(expFmtNum) : null) ||

        (exp.cadetNumber ? lookupMap.get(exp.cadetNumber) : null);



      if (matched) {

        matched.expensesCount += 1;

        matched.totalAmount += exp.amount;

        matched.expenses.push(exp);

      } else {

        const fallbackKey = expCleanNum || exp.userId || exp.id || 'unknown';

        const newItem: CadetMonthlyExtractItem = {

          id: exp.userId || fallbackKey,

          cadetNumber: expFmtNum || exp.cadetNumber || '---',

          warName: exp.userName || 'CADETE',

          fullName: exp.userName || 'Cadete AFA',

          squadron: '1º Esquadrão',

          expensesCount: 1,

          totalAmount: exp.amount,

          expenses: [exp],

        };

        itemsMap.set(fallbackKey, newItem);

        lookupMap.set(fallbackKey, newItem);

        if (expCleanNum) lookupMap.set(expCleanNum, newItem);

        if (expFmtNum) lookupMap.set(expFmtNum, newItem);

      }

    });



    return Array.from(itemsMap.values()).sort((a, b) => a.cadetNumber.localeCompare(b.cadetNumber, undefined, { numeric: true }));

  }, [allUsers, periodExpenses]);



  // Filtragem da Lista de Cadetes do Extrato

  const filteredCadetList = useMemo(() => {

    return cadetMonthlyList.filter((item) => {

      const matchesSquadron = extratoSquadronFilter === 'all' || item.squadron.toLowerCase().includes(extratoSquadronFilter.toLowerCase());

      const query = extratoSearchQuery.toLowerCase().trim();

      const rawNum = (item.cadetNumber || '').toLowerCase();

      const cleanNum = rawNum.replace(/\D/g, '');

      const cleanQuery = query.replace(/\D/g, '');



      const matchesSearch =

        !query ||

        rawNum.includes(query) ||

        (cleanQuery.length > 0 && cleanNum.includes(cleanQuery)) ||

        (item.warName || '').toLowerCase().includes(query) ||

        (item.fullName || '').toLowerCase().includes(query) ||

        (item.squadron || '').toLowerCase().includes(query);

      return matchesSquadron && matchesSearch;

    });

  }, [cadetMonthlyList, extratoSquadronFilter, extratoSearchQuery]);



  // Métricas do Extrato do Mês

  const totalExtractAmount = useMemo(() => {

    return filteredCadetList.reduce((acc, curr) => acc + curr.totalAmount, 0);

  }, [filteredCadetList]);



  const totalExtractItems = useMemo(() => {

    return filteredCadetList.reduce((acc, curr) => acc + curr.expensesCount, 0);

  }, [filteredCadetList]);



  const avgCadetExtract = filteredCadetList.length > 0 ? totalExtractAmount / filteredCadetList.length : 0;



  // Toggle de expansão de cadete

  const toggleExpandCadet = (cadetNumber: string) => {

    setExpandedCadets((prev) => {

      const next = new Set(prev);

      if (next.has(cadetNumber)) {

        next.delete(cadetNumber);

      } else {

        next.add(cadetNumber);

      }

      return next;

    });

  };



  // --- ABA 2: CÁLCULO DINÂMICO DE REPASSES AOS CLUBES A PARTIR DO BANCO ---

  const repasseList = useMemo(() => {

    return clubs.map((club) => {

      const clubExpenses = periodExpenses.filter((e) => e.clubId === club.id || e.clubName?.toLowerCase() === club.name.toLowerCase());

      const amount = clubExpenses.reduce((acc, curr) => acc + curr.amount, 0);

      return {

        id: club.id,

        clubName: club.name,

        category: club.category || 'Clube SCAER',

        billingPeriod: selectedPeriod === 'all' ? 'Consolidado' : selectedPeriod,

        amount,

        launchesCount: clubExpenses.length,

      };

    });

  }, [clubs, periodExpenses, selectedPeriod]);



  const filteredRepasse = useMemo(() => {

    return repasseList.filter((item) =>

      item.clubName.toLowerCase().includes(repasseSearchTerm.toLowerCase()) ||

      item.category.toLowerCase().includes(repasseSearchTerm.toLowerCase())

    );

  }, [repasseList, repasseSearchTerm]);



  const totalRepasseAmount = useMemo(() => {

    return filteredRepasse.reduce((acc, curr) => acc + curr.amount, 0);

  }, [filteredRepasse]);



  // --- ABA 3: SÓCIOS DOS CLUBES (100% POCKETBASE) ---

  const activeMemberships = useMemo(() => {

    return memberships.filter((m) => m.status === 'approved' || m.status === 'active');

  }, [memberships]);



  const filteredMemberships = useMemo(() => {

    return activeMemberships.filter((m) => {

      const matchesClub = memberClubFilter === 'all' || m.clubId === memberClubFilter;

      const query = memberSearchQuery.toLowerCase();

      const matchesSearch =

        (m.userName || '').toLowerCase().includes(query) ||

        (m.cadetNumber || '').toLowerCase().includes(query) ||

        (m.squadron || '').toLowerCase().includes(query);

      return matchesClub && matchesSearch;

    });

  }, [activeMemberships, memberClubFilter, memberSearchQuery]);



  // --- ABA 4: AUDITORIA (LANÇAMENTOS DETALHADOS REAIS) ---

  const filteredExpenses = useMemo(() => {

    return periodExpenses.filter((e) => {

      const matchesClub = auditClubFilter === 'all' || e.clubId === auditClubFilter;

      const query = auditSearchQuery.toLowerCase();

      const matchesSearch =

        (e.userName || '').toLowerCase().includes(query) ||

        (e.cadetNumber || '').toLowerCase().includes(query) ||

        (e.description || '').toLowerCase().includes(query) ||

        (e.clubName || '').toLowerCase().includes(query);

      return matchesClub && matchesSearch;

    });

  }, [periodExpenses, auditClubFilter, auditSearchQuery]);



  // Handler para Excluir Lançamento

  const handleDeleteExpense = async (expenseId: string) => {

    if (!confirm('Tem certeza que deseja cancelar/excluir este lançamento da cédula?')) return;

    try {

      await DatabaseService.deleteTransaction(expenseId);

      // Remove o lançamento localmente em tempo real sem recarregar a tela nem fechar o extrato do cadete

      setPeriodExpenses((prev) => prev.filter((e) => e.id !== expenseId));

    } catch (err) {

      console.error('Erro ao excluir lançamento:', err);

      alert('Erro ao excluir lançamento no banco de dados.');

    }

  };



  // Handler para Lançamentos da Diretoria

  const handleLaunchIndividual = async (launch: Omit<Expense, 'id' | 'createdAt' | 'status'>) => {

    await DatabaseService.createTransaction(launch);

    if (onRefreshData) onRefreshData();

  };



  const handleLaunchBulk = async (launches: Omit<Expense, 'id' | 'createdAt' | 'status'>[]) => {

    await DatabaseService.createTransactions(launches);

    if (onRefreshData) onRefreshData();

  };



  // --- EXPORTAÇÕES: EXTRATO DO MÊS ---

  const handleExportExtratoXLSX = () => {

    const rows = filteredCadetList.map((item) => ({

      'Número de Ordem': item.cadetNumber,

      'Nome de Guerra': item.warName,

      'Nome Completo': item.fullName,

      'Esquadrão': item.squadron,

      'Quantidade de Lançamentos': item.expensesCount,

      'Valor Total Cédula (R$)': item.totalAmount.toFixed(2),

      'Mês de Referência': selectedPeriod === 'all' ? 'Todos os Meses' : selectedPeriod,

    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Extrato_Mensal');

    XLSX.writeFile(workbook, `Extrato_Mensal_Cadetes_${selectedPeriod}.xlsx`);

  };



  const handleExportExtratoPDF = () => {

    const doc = new jsPDF();

    doc.setFont('helvetica', 'bold');

    doc.setFontSize(13);

    doc.text('EXTRATO MENSAL DA CÉDULA - DIRETORIA DE CÉDULA SCAER', 14, 15);

    doc.setFont('helvetica', 'normal');

    doc.setFontSize(9);

    doc.text(

      `Período: ${selectedPeriod === 'all' ? 'Consolidado Geral' : selectedPeriod} | Total Apurado: R$ ${totalExtractAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | Total de Cadetes: ${filteredCadetList.length}`,

      14,

      22

    );



    let y = 32;

    doc.setFont('helvetica', 'bold');

    doc.text('Nº', 14, y);

    doc.text('Nome de Guerra', 35, y);

    doc.text('Esquadrão', 85, y);

    doc.text('Itens', 135, y);

    doc.text('Valor Total (R$)', 160, y);

    doc.line(14, y + 2, 195, y + 2);



    y += 8;

    doc.setFont('helvetica', 'normal');

    filteredCadetList.slice(0, 42).forEach((item) => {

      if (y > 280) {

        doc.addPage();

        y = 15;

      }

      doc.text(item.cadetNumber, 14, y);

      doc.text(item.warName.substring(0, 20), 35, y);

      doc.text(item.squadron.substring(0, 20), 85, y);

      doc.text(String(item.expensesCount), 135, y);

      doc.text(`R$ ${item.totalAmount.toFixed(2)}`, 160, y);

      y += 6;

    });

    doc.save(`Extrato_Mensal_Cadetes_${selectedPeriod}.pdf`);

  };



  // --- EXPORTAÇÕES: REPASSE ---

  const handleExportRepasseXLSX = () => {

    const rows = filteredRepasse.map((item) => ({

      'Entidade / Clube / Diretoria': item.clubName,

      'Categoria': item.category,

      'Lançamentos': item.launchesCount,

      'Valor a Repassar (R$)': item.amount.toFixed(2),

      'Mês Referência': item.billingPeriod,

    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Repasse');

    XLSX.writeFile(workbook, `Repasse_Clubes_SCAER_${selectedPeriod}.xlsx`);

  };



  const handleExportRepassePDF = () => {

    const doc = new jsPDF();

    doc.setFont('helvetica', 'bold');

    doc.setFontSize(13);

    doc.text('VALORES A REPASSAR - CLUBES E DIRETORIAS SCAER', 14, 15);

    doc.setFont('helvetica', 'normal');

    doc.setFontSize(9);

    doc.text(`Total Geral a Repassar: R$ ${totalRepasseAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 14, 22);



    let y = 32;

    doc.setFont('helvetica', 'bold');

    doc.text('Entidade / Clube', 14, y);

    doc.text('Categoria', 100, y);

    doc.text('Valor Repasse (R$)', 160, y);

    doc.line(14, y + 2, 195, y + 2);



    y += 8;

    doc.setFont('helvetica', 'normal');

    filteredRepasse.forEach((item) => {

      if (y > 280) {

        doc.addPage();

        y = 15;

      }

      doc.text(item.clubName, 14, y);

      doc.text(item.category, 100, y);

      doc.text(`R$ ${item.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 160, y);

      y += 6.5;

    });

    doc.save(`Repasse_Clubes_SCAER_${selectedPeriod}.pdf`);

  };



  // --- EXPORTAÇÕES: SÓCIOS ---

  const handleExportMembersXLSX = () => {

    const rows = filteredMemberships.map((m) => {

      const club = clubs.find((c) => c.id === m.clubId);

      return {

        'Número': m.cadetNumber,

        'Cadete (Nome de Guerra)': m.userName,

        'Esquadrão': m.squadron || '1º Esquadrão',

        'Clube SCAER': m.clubName || club?.name || 'Clube',

        'Mensalidade (R$)': club ? club.monthlyFee.toFixed(2) : '0.00',

        'Status': 'Sócio Ativo',

      };

    });



    const worksheet = XLSX.utils.json_to_sheet(rows);

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Socios_Clubes');

    XLSX.writeFile(workbook, `Socios_Clubes_SCAER.xlsx`);

  };



  const handleExportMembersPDF = () => {

    const doc = new jsPDF();

    doc.setFont('helvetica', 'bold');

    doc.setFontSize(13);

    doc.text('RELAÇÃO DE SÓCIOS ATIVOS DOS CLUBES SCAER', 14, 15);

    doc.setFont('helvetica', 'normal');

    doc.setFontSize(9);

    doc.text(`Total de Sócios Listados: ${filteredMemberships.length} cadetes`, 14, 22);



    let y = 32;

    doc.setFont('helvetica', 'bold');

    doc.text('Nº e Guerra', 14, y);

    doc.text('Esquadrão', 75, y);

    doc.text('Clube SCAER', 120, y);

    doc.text('Status', 165, y);

    doc.line(14, y + 2, 195, y + 2);



    y += 8;

    doc.setFont('helvetica', 'normal');

    filteredMemberships.slice(0, 42).forEach((m) => {

      if (y > 280) {

        doc.addPage();

        y = 15;

      }

      doc.text(`${m.cadetNumber} ${m.userName}`.substring(0, 26), 14, y);

      doc.text((m.squadron || '1º Esquadrão').substring(0, 20), 75, y);

      doc.text((m.clubName || 'Clube').substring(0, 22), 120, y);

      doc.text('Ativo', 165, y);

      y += 6;

    });

    doc.save('Socios_Clubes_SCAER.pdf');

  };



  // --- GERAR RELATÓRIO PDF FORMAL ---

  const handleGenerateReport = async (reportType: 'synthetic' | 'detailed') => {

    setIsGeneratingPdf(true);

    try {

      const hashRaw = `${selectedPeriod}_${directorUser.id}_${totalExtractAmount}_${periodExpenses.length}_${reportType}_${Date.now()}`;

      const verificationHash = await generateSHA256(hashRaw);



      const { pdfUrl, hash } = await generateDirectorPDFReport({

        period: selectedPeriod,

        director: directorUser,

        expenses: periodExpenses,

        totalAmount: totalExtractAmount,

        totalLaunches: periodExpenses.length,

        totalCadets: filteredCadetList.length,

        verificationHash,

        reportType,

      });



      await onSaveReport({

        title: `Relatório ${reportType === 'synthetic' ? 'Sintético' : 'Detalhado'} SCAER - ${selectedPeriod}`,

        period: selectedPeriod,

        reportType,

        totalAmount: totalExtractAmount,

        totalLaunches: periodExpenses.length,

        totalCadets: filteredCadetList.length,

        verificationHash: hash,

        issuedAt: new Date().toLocaleString('pt-BR'),

        issuedBy: directorUser.id,

        directorName: `${directorUser.cadetNumber} ${directorUser.warName}`,

        pdfUrl,

      });



      const link = document.createElement('a');

      link.href = pdfUrl;

      link.download = `Relatorio_SCAER_${reportType.toUpperCase()}_${selectedPeriod}.pdf`;

      link.click();

    } catch (err) {

      console.error('Erro ao gerar relatório:', err);

      alert('Erro ao gerar relatório em PDF.');

    } finally {

      setIsGeneratingPdf(false);

    }

  };



  // Exportar CSV

  const handleExportSheets = () => {

    if (periodExpenses.length === 0) {

      alert('Nenhum lançamento no banco para exportação neste período.');

      return;

    }



    const headers = ['Matricula', 'Cadete', 'Clube', 'Descricao', 'Categoria', 'Valor', 'Data', 'Gestor'];

    const rows = filteredExpenses.map((exp) => [

      `"${exp.cadetNumber}"`,

      `"${exp.userName}"`,

      `"${exp.clubName}"`,

      `"${exp.description}"`,

      `"${exp.category}"`,

      exp.amount.toFixed(2),

      `"${exp.createdAt}"`,

      `"${exp.createdByName}"`,

    ]);



    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);

    const link = document.createElement('a');

    link.setAttribute('href', encodedUri);

    link.setAttribute('download', `SCAER_Cedula_Export_${selectedPeriod}.csv`);

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

  };



  return (

    <div className="space-y-6">

      

      {/* Banner Superior da Diretoria - Paleta Neutra Militar Slate com Alto Contraste */}

      <div className={`p-5 sm:p-6 rounded-xl border transition-colors ${

        isDark

          ? 'bg-slate-900 border-slate-800 text-slate-100'

          : 'bg-white border-slate-200 text-slate-900 shadow-sm'

      }`}>

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">

          <div className="space-y-1">

            <div className="flex items-center space-x-2">

              <span className={`px-2 py-0.5 text-[10px] font-bold rounded border uppercase tracking-wider ${

                isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-700'

              }`}>

                DIRETORIA DE CÉDULA SCAER

              </span>

              <span className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-500 font-semibold'}`}>

                CONTABILIDADE & EXTRATOS (DADOS REAIS)

              </span>

            </div>



            <h2 className={`text-xl font-bold tracking-tight ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

              Painel Contábil da Diretoria

            </h2>

            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

              Diretor Responsável:{' '}

              <strong className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>

                {directorUser.cadetNumber} {directorUser.warName}

              </strong>{' '}

              ({directorUser.name})

            </p>

          </div>



          {/* Botões de Ação Principais */}

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">

            <button

              onClick={() => {

                setScannedCadetInfo(null);

                setShowLaunchModal(true);

              }}

              className={`px-3.5 py-2 rounded-lg font-semibold text-xs transition-colors flex items-center space-x-1.5 ${

                isDark

                  ? 'bg-slate-100 text-slate-950 hover:bg-white'

                  : 'bg-slate-900 text-white hover:bg-slate-800'

              }`}

            >

              <PlusCircle className="w-4 h-4" />

              <span>Lançar Gasto</span>

            </button>



            <button

              onClick={() => {

                setScannedCadetInfo(null);

                setShowEventLaunchModal(true);

              }}

              className={`px-3.5 py-2 rounded-lg font-semibold text-xs transition-colors flex items-center space-x-1.5 ${

                isDark

                  ? 'bg-slate-100 text-slate-950 hover:bg-white'

                  : 'bg-slate-900 text-white hover:bg-slate-800'

              }`}

            >

              <PlusCircle className="w-4 h-4" />

              <span>Lançar Gasto EVENTO</span>

            </button>



            <button

              onClick={() => setDirectorSubTab('events')}

              className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                isDark

                  ? 'bg-slate-950 border-slate-800 text-amber-400 hover:bg-slate-800'

                  : 'bg-white border-slate-300 text-amber-600 hover:bg-slate-100'

              }`}

            >

              <Store className="w-4 h-4" />

              <span>Cadastro Eventos</span>

            </button>



            <button

              onClick={handleExportSheets}

              className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                isDark

                  ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                  : 'bg-white border-slate-300 text-slate-700 hover:text-slate-900 hover:bg-slate-100'

              }`}

            >

              <FileSpreadsheet className="w-4 h-4" />

              <span>Exportar CSV</span>

            </button>



            <button

              disabled={isGeneratingPdf}

              onClick={() => handleGenerateReport('synthetic')}

              className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                isDark

                  ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                  : 'bg-white border-slate-300 text-slate-700 hover:text-slate-900 hover:bg-slate-100'

              }`}

            >

              <FileText className="w-4 h-4" />

              <span>PDF Sintético</span>

            </button>



            <button

              disabled={isGeneratingPdf}

              onClick={() => handleGenerateReport('detailed')}

              className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                isDark

                  ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'

                  : 'bg-slate-200 border-slate-300 text-slate-800 hover:bg-slate-300'

              }`}

            >

              <Download className="w-4 h-4" />

              <span>PDF Detalhado</span>

            </button>



            <button

              onClick={() => setShowQrScanner(true)}

              className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                isDark

                  ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'

                  : 'bg-slate-200 border-slate-300 text-slate-800 hover:bg-slate-300'

              }`}

            >

              <QrCode className="w-4 h-4" />

              <span>Escanear QR</span>

            </button>

          </div>

        </div>

      </div>



      {/* Navegação de Abas Neutra Slate/Aço Militar */}

      <div className={`flex items-center space-x-2 border-b pb-2 overflow-x-auto ${

        isDark ? 'border-slate-800' : 'border-slate-200'

      }`}>

        <button

          onClick={() => setDirectorSubTab('extrato')}

          className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 shrink-0 ${

            directorSubTab === 'extrato'

              ? isDark

                ? 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm'

                : 'bg-slate-900 text-white shadow-sm'

              : isDark

                ? 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800/80 hover:bg-slate-900'

                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'

          }`}

        >

          <Receipt className="w-4 h-4" />

          <span>1. Extrato do Mês ({cadetMonthlyList.length} cadetes)</span>

        </button>



        <button

          onClick={() => setDirectorSubTab('repasse')}

          className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 shrink-0 ${

            directorSubTab === 'repasse'

              ? isDark

                ? 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm'

                : 'bg-slate-900 text-white shadow-sm'

              : isDark

                ? 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800/80 hover:bg-slate-900'

                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'

          }`}

        >

          <DollarSign className="w-4 h-4" />

          <span>2. Repasse aos Clubes ({clubs.length} clubes)</span>

        </button>



        <button

          onClick={() => setDirectorSubTab('members')}

          className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 shrink-0 ${

            directorSubTab === 'members'

              ? isDark

                ? 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm'

                : 'bg-slate-900 text-white shadow-sm'

              : isDark

                ? 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800/80 hover:bg-slate-900'

                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'

          }`}

        >

          <Users className="w-4 h-4" />

          <span>3. Sócios dos 14 Clubes ({activeMemberships.length})</span>

        </button>



        <button

          onClick={() => setDirectorSubTab('audit')}

          className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 shrink-0 ${

            directorSubTab === 'audit'

              ? isDark

                ? 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm'

                : 'bg-slate-900 text-white shadow-sm'

              : isDark

                ? 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800/80 hover:bg-slate-900'

                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'

          }`}

        >

          <FileCheck className="w-4 h-4" />

          <span>4. Lançamentos Detalhados ({periodExpenses.length})</span>

        </button>



        <button

          onClick={() => setDirectorSubTab('events')}

          className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 shrink-0 ${

            directorSubTab === 'events'

              ? isDark

                ? 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm'

                : 'bg-slate-900 text-white shadow-sm'

              : isDark

                ? 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800/80 hover:bg-slate-900'

                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'

          }`}

        >

          <Store className="w-4 h-4" />

          <span>5. Cadastro Eventos</span>

        </button>



        <button

          onClick={() => setDirectorSubTab('event_query')}

          className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 shrink-0 ${

            directorSubTab === 'event_query'

              ? isDark

                ? 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm'

                : 'bg-slate-900 text-white shadow-sm'

              : isDark

                ? 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800/80 hover:bg-slate-900'

                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'

          }`}

        >

          <Search className="w-4 h-4" />

          <span>6. Consulta Eventos</span>

        </button>

      </div>



      {/* ========================================================================= */}

      {/* ABA 1: EXTRATO DO MÊS POR CADETE (DADOS REAIS DO BANCO)                  */}

      {/* ========================================================================= */}

      {directorSubTab === 'extrato' && (

        <div className="space-y-6 animate-in fade-in">

          

          {/* Seletor de Período do Extrato */}

          <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div className="flex items-center space-x-3">

              <div className={`p-2 rounded-lg border ${

                isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'

              }`}>

                <Calendar className="w-4 h-4" />

              </div>

              <div>

                <h3 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

                  Mês de Referência do Extrato

                </h3>

                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                  Calculado dinamicamente com base nas despesas reais registradas no banco

                </p>

              </div>

            </div>



            <div className="flex items-center space-x-2">

              <select

                value={selectedPeriod}

                onChange={(e) => {

                  setSelectedPeriod(e.target.value);

                  setExtratoPage(1);

                }}

                className={`border rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-200'

                    : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                }`}

              >

                <option value="all">Consolidado Geral (Todos os Meses)</option>

                <option value="2026-10">Outubro / 2026 (Prévia)</option>

                <option value="2026-09">Setembro / 2026</option>

                <option value="2026-08">Agosto / 2026</option>

                <option value="2026-07">Julho / 2026</option>

                <option value="2026-06">Junho / 2026</option>

                <option value="2026-05">Maio / 2026</option>

                <option value="2026-04">Abril / 2026</option>

                <option value="2026-03">Março / 2026</option>

                <option value="2026-02">Fevereiro / 2026</option>

                <option value="2026-01">Janeiro / 2026</option>

              </select>

            </div>

          </div>



          {/* Cards de Resumo Contábil do Mês */}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            

            <div className={`p-4 rounded-xl border transition-colors ${

              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

            }`}>

              <div className={`flex items-center justify-between text-xs font-semibold uppercase tracking-wider mb-1 ${

                isDark ? 'text-slate-400' : 'text-slate-600'

              }`}>

                <span>Total da Cédula no Mês</span>

                <Receipt className="w-4 h-4" />

              </div>

              <div className={`text-xl font-bold font-mono ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

                R$ {totalExtractAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

              </div>

              <div className={`mt-1 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                Período: {selectedPeriod === 'all' ? 'Todos os Meses' : selectedPeriod}

              </div>

            </div>



            <div className={`p-4 rounded-xl border transition-colors ${

              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

            }`}>

              <div className={`flex items-center justify-between text-xs font-semibold uppercase tracking-wider mb-1 ${

                isDark ? 'text-slate-400' : 'text-slate-600'

              }`}>

                <span>Cadetes Cadastrados</span>

                <Users className="w-4 h-4" />

              </div>

              <div className={`text-xl font-bold font-mono ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

                {filteredCadetList.length} <span className="text-xs font-normal text-slate-500">cadetes no banco</span>

              </div>

              <div className={`mt-1 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                {filteredCadetList.filter((c) => c.totalAmount > 0).length} com lançamentos ativos

              </div>

            </div>



            <div className={`p-4 rounded-xl border transition-colors ${

              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

            }`}>

              <div className={`flex items-center justify-between text-xs font-semibold uppercase tracking-wider mb-1 ${

                isDark ? 'text-slate-400' : 'text-slate-600'

              }`}>

                <span>Total de Lançamentos</span>

                <Layers className="w-4 h-4" />

              </div>

              <div className={`text-xl font-bold font-mono ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

                {totalExtractItems} <span className="text-xs font-normal text-slate-500">itens</span>

              </div>

              <div className={`mt-1 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                Despesas registradas no PocketBase

              </div>

            </div>



            <div className={`p-4 rounded-xl border transition-colors ${

              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

            }`}>

              <div className={`flex items-center justify-between text-xs font-semibold uppercase tracking-wider mb-1 ${

                isDark ? 'text-slate-400' : 'text-slate-600'

              }`}>

                <span>Média por Cadete</span>

                <ArrowUpDown className="w-4 h-4" />

              </div>

              <div className={`text-xl font-bold font-mono ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

                R$ {avgCadetExtract.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

              </div>

              <div className={`mt-1 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                Ticket médio no período

              </div>

            </div>



          </div>



          {/* Barra de Filtros e Exportações do Extrato */}

          <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">

              <div className="flex items-center space-x-2">

                <Filter className="w-4 h-4 text-slate-500 shrink-0" />

                <select

                  value={extratoSquadronFilter}

                  onChange={(e) => {

                    setExtratoSquadronFilter(e.target.value);

                    setExtratoPage(1);

                  }}

                  className={`border rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none ${

                    isDark

                      ? 'bg-slate-950 border-slate-800 text-slate-200'

                      : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                  }`}

                >

                  <option value="all">Todos os Esquadrões</option>

                  <option value="1º Esquadrão">1º Esquadrão</option>

                  <option value="2º Esquadrão">2º Esquadrão</option>

                  <option value="3º Esquadrão">3º Esquadrão</option>

                  <option value="4º Esquadrão">4º Esquadrão</option>

                  <option value="Athos">Esquadrão Athos</option>

                </select>

              </div>



              <div className="relative flex-1 md:w-64">

                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />

                <input

                  type="text"

                  placeholder="Buscar por número, nome de guerra..."

                  value={extratoSearchQuery}

                  onChange={(e) => {

                    setExtratoSearchQuery(e.target.value);

                    setExtratoPage(1);

                  }}

                  className={`w-full border rounded-lg pl-9 pr-3 py-1.5 text-xs focus:outline-none ${

                    isDark

                      ? 'bg-slate-950 border-slate-800 text-slate-200'

                      : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                  }`}

                />

              </div>

            </div>



            <div className="flex items-center space-x-2 w-full md:w-auto justify-end">

              <button

                onClick={handleExportExtratoXLSX}

                className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                    : 'bg-white border-slate-300 text-slate-800 hover:text-slate-950 hover:bg-slate-100 shadow-sm'

                }`}

              >

                <FileSpreadsheet className="w-4 h-4" />

                <span>Exportar XLSX</span>

              </button>



              <button

                onClick={handleExportExtratoPDF}

                className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                    : 'bg-white border-slate-300 text-slate-800 hover:text-slate-950 hover:bg-slate-100 shadow-sm'

                }`}

              >

                <Download className="w-4 h-4" />

                <span>Exportar PDF</span>

              </button>

            </div>

          </div>



          {/* Tabela do Extrato Consolidado por Cadete (com expansão) */}

          <div className={`rounded-xl border overflow-hidden transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div className="overflow-x-auto">

              <table className="w-full text-left text-xs">

                <thead className={`font-mono uppercase border-b ${

                  isDark ? 'bg-slate-950 text-slate-400 border-slate-800' : 'bg-slate-100 text-slate-700 font-bold border-slate-300'

                }`}>

                  <tr>

                    <th className="p-3.5 w-10 text-center"></th>

                    <th className="p-3.5">Número</th>

                    <th className="p-3.5">Nome de Guerra</th>

                    <th className="p-3.5">Esquadrão</th>

                    <th className="p-3.5 text-center">Lançamentos</th>

                    <th className="p-3.5 text-right">Valor Total Cédula (R$)</th>

                    <th className="p-3.5 text-center">Ação</th>

                  </tr>

                </thead>

                <tbody className={`divide-y ${isDark ? 'divide-slate-800/60' : 'divide-slate-200'}`}>

                  {filteredCadetList.length === 0 ? (

                    <tr>

                      <td colSpan={7} className="p-8 text-center text-slate-500 font-medium">

                        Nenhum cadete encontrado no extrato deste período com os filtros aplicados.

                      </td>

                    </tr>

                  ) : (

                    filteredCadetList.slice((extratoPage - 1) * 35, extratoPage * 35).map((cadet) => {

                      const isExpanded = expandedCadets.has(cadet.cadetNumber);

                      return (

                        <React.Fragment key={cadet.cadetNumber || cadet.id}>

                          <tr

                            onClick={() => toggleExpandCadet(cadet.cadetNumber)}

                            className={`cursor-pointer transition-colors ${

                              isDark

                                ? isExpanded ? 'bg-slate-800/50' : 'hover:bg-slate-800/30'

                                : isExpanded ? 'bg-slate-100/90' : 'hover:bg-slate-50'

                            }`}

                          >

                            <td className="p-3.5 text-center text-slate-400">

                              {isExpanded ? (

                                <ChevronDown className="w-4 h-4 mx-auto" />

                              ) : (

                                <ChevronRight className="w-4 h-4 mx-auto" />

                              )}

                            </td>

                            <td className={`p-3.5 font-bold font-mono ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>

                              {cadet.cadetNumber}

                            </td>

                            <td className={`p-3.5 font-bold ${isDark ? 'text-slate-100' : 'text-slate-950'}`}>

                              {cadet.warName}

                            </td>

                            <td className="p-3.5">

                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${

                                isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-800'

                              }`}>

                                {cadet.squadron}

                              </span>

                            </td>

                            <td className={`p-3.5 text-center font-mono font-semibold ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>

                              {cadet.expensesCount}

                            </td>

                            <td className={`p-3.5 text-right font-black font-mono text-sm ${isDark ? 'text-slate-100' : 'text-slate-950'}`}>

                              R$ {cadet.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

                            </td>

                            <td className="p-3.5 text-center" onClick={(e) => e.stopPropagation()}>

                              <button

                                onClick={() => toggleExpandCadet(cadet.cadetNumber)}

                                className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${

                                  isDark

                                    ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                                    : 'bg-white border-slate-300 text-slate-800 hover:text-slate-950 hover:bg-slate-100 shadow-xs'

                                }`}

                              >

                                {isExpanded ? 'Ocultar' : 'Ver Extrato'}

                              </button>

                            </td>

                          </tr>



                          {/* Detalhamento Expansível dos Lançamentos do Cadete */}

                          {isExpanded && (

                            <tr className={isDark ? 'bg-slate-950/70' : 'bg-slate-50/80'}>

                              <td colSpan={7} className="p-4 pl-12">

                                <div className={`p-4 rounded-xl border space-y-3 ${

                                  isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-300 shadow-sm'

                                }`}>

                                  <div className="flex items-center justify-between">

                                    <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>

                                      Detalhamento do Extrato • Cadete {cadet.cadetNumber} {cadet.warName} ({selectedPeriod})

                                    </h4>

                                    <span className={`text-xs font-mono font-bold ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>

                                      Total no Mês: R$ {cadet.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

                                    </span>

                                  </div>



                                  {cadet.expenses.length === 0 ? (

                                    <p className={`text-xs italic py-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                                      Nenhum lançamento ou consumo registrado para este cadete no período ({selectedPeriod}).

                                    </p>

                                  ) : (

                                    <div className="overflow-x-auto">

                                      <table className="w-full text-left text-xs">

                                        <thead className={`font-mono uppercase border-b ${

                                          isDark ? 'bg-slate-950 text-slate-400 border-slate-800' : 'bg-slate-100 text-slate-700 font-bold border-slate-200'

                                        }`}>

                                          <tr>

                                            <th className="p-2.5">Data</th>

                                            <th className="p-2.5">Clube / Emissor</th>

                                            <th className="p-2.5">Descrição do Gasto</th>

                                            <th className="p-2.5">Categoria</th>

                                            <th className="p-2.5 text-right">Valor (R$)</th>

                                            <th className="p-2.5 text-right">Ação</th>

                                          </tr>

                                        </thead>

                                        <tbody className={`divide-y ${isDark ? 'divide-slate-800/60' : 'divide-slate-200'}`}>

                                          {cadet.expenses.map((exp) => (

                                            <tr key={exp.id} className={isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}>

                                              <td className={`p-2.5 font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                                                {new Date(exp.createdAt || Date.now()).toLocaleDateString('pt-BR')}

                                              </td>

                                              <td className={`p-2.5 font-semibold ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>

                                                {exp.clubName}

                                              </td>

                                              <td className={`p-2.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>

                                                {exp.description}

                                              </td>

                                              <td className="p-2.5">

                                                <span className={`px-2 py-0.5 rounded text-[10px] border ${

                                                  isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-700'

                                                }`}>

                                                  {exp.category}

                                                </span>

                                              </td>

                                              <td className={`p-2.5 text-right font-mono font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

                                                R$ {exp.amount.toFixed(2)}

                                              </td>

                                              <td className="p-2.5 text-right">

                                                <button

                                                  onClick={() => handleDeleteExpense(exp.id)}

                                                  className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"

                                                  title="Excluir Lançamento"

                                                >

                                                  <Trash2 className="w-3.5 h-3.5" />

                                                </button>

                                              </td>

                                            </tr>

                                          ))}

                                        </tbody>

                                      </table>

                                    </div>

                                  )}

                                </div>

                              </td>

                            </tr>

                          )}

                        </React.Fragment>

                      );

                    })

                  )}

                </tbody>

              </table>

            </div>



            {/* Paginação do Extrato */}

            <div className={`p-4 border-t flex items-center justify-between text-xs ${

              isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600'

            }`}>

              <span>

                Página {extratoPage} de {Math.ceil(filteredCadetList.length / 35) || 1} ({filteredCadetList.length} cadetes listados)

              </span>

              <div className="flex items-center space-x-2">

                <button

                  disabled={extratoPage === 1}

                  onClick={() => setExtratoPage((p) => Math.max(1, p - 1))}

                  className={`px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-30 ${

                    isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'

                  }`}

                >

                  Anterior

                </button>

                <button

                  disabled={extratoPage >= Math.ceil(filteredCadetList.length / 35)}

                  onClick={() => setExtratoPage((p) => p + 1)}

                  className={`px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-30 ${

                    isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'

                  }`}

                >

                  Próxima

                </button>

              </div>

            </div>



          </div>



        </div>

      )}



      {/* ========================================================================= */}

      {/* ABA 2: REPASSE FINANCEIRO AOS CLUBES (DINÂMICO PELO BANCO)               */}

      {/* ========================================================================= */}

      {directorSubTab === 'repasse' && (

        <div className="space-y-6 animate-in fade-in">

          

          <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div>

              <h4 className={`text-sm font-bold flex items-center space-x-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

                <DollarSign className="w-4 h-4 text-slate-400" />

                <span>Valores a Repassar para Clubes ({selectedPeriod === 'all' ? 'Todos os Meses' : selectedPeriod})</span>

              </h4>

              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                Total Geral de Repasse apurado no banco:{' '}

                <strong className={`font-mono ${isDark ? 'text-slate-100' : 'text-slate-900 font-black'}`}>

                  R$ {totalRepasseAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

                </strong>

              </p>

            </div>



            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">

              <div className="relative flex-1 md:w-56">

                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />

                <input

                  type="text"

                  placeholder="Buscar clube ou entidade..."

                  value={repasseSearchTerm}

                  onChange={(e) => setRepasseSearchTerm(e.target.value)}

                  className={`w-full border rounded-lg pl-9 pr-3 py-1.5 text-xs focus:outline-none ${

                    isDark

                      ? 'bg-slate-950 border-slate-800 text-slate-200'

                      : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                  }`}

                />

              </div>



              <button

                onClick={handleExportRepasseXLSX}

                className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                    : 'bg-white border-slate-300 text-slate-800 hover:text-slate-950 hover:bg-slate-100 shadow-sm'

                }`}

              >

                <FileSpreadsheet className="w-4 h-4" />

                <span>Exportar XLSX</span>

              </button>



              <button

                onClick={handleExportRepassePDF}

                className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                    : 'bg-white border-slate-300 text-slate-800 hover:text-slate-950 hover:bg-slate-100 shadow-sm'

                }`}

              >

                <Download className="w-4 h-4" />

                <span>Exportar PDF</span>

              </button>

            </div>

          </div>



          <div className={`rounded-xl border overflow-hidden transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div className="overflow-x-auto">

              <table className="w-full text-left text-xs">

                <thead className={`font-mono uppercase border-b ${

                  isDark ? 'bg-slate-950 text-slate-400 border-slate-800' : 'bg-slate-100 text-slate-700 font-bold border-slate-300'

                }`}>

                  <tr>

                    <th className="p-3.5">Clube / Entidade / Diretoria</th>

                    <th className="p-3.5">Categoria</th>

                    <th className="p-3.5 text-center">Lançamentos no Mês</th>

                    <th className="p-3.5 text-right">Valor Total a Repassar (R$)</th>

                  </tr>

                </thead>

                <tbody className={`divide-y ${isDark ? 'divide-slate-800/60' : 'divide-slate-200'}`}>

                  {filteredRepasse.length === 0 ? (

                    <tr>

                      <td colSpan={4} className="p-8 text-center text-slate-500 font-medium">

                        Nenhum clube encontrado com os filtros aplicados.

                      </td>

                    </tr>

                  ) : (

                    filteredRepasse.map((r) => (

                      <tr key={r.id} className={`transition-colors ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}`}>

                        <td className={`p-3.5 font-bold text-sm ${isDark ? 'text-slate-100' : 'text-slate-950'}`}>

                          {r.clubName}

                        </td>

                        <td className="p-3.5">

                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${

                            isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-800'

                          }`}>

                            {r.category}

                          </span>

                        </td>

                        <td className={`p-3.5 text-center font-mono font-semibold ${isDark ? 'text-slate-400' : 'text-slate-700'}`}>

                          {r.launchesCount}

                        </td>

                        <td className={`p-3.5 text-right font-black font-mono text-sm ${isDark ? 'text-slate-100' : 'text-slate-950'}`}>

                          R$ {r.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

                        </td>

                      </tr>

                    ))

                  )}

                </tbody>

                <tfoot className={`font-mono uppercase border-t ${

                  isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-slate-100 text-slate-900 border-slate-300 font-bold'

                }`}>

                  <tr>

                    <td colSpan={3} className="p-3.5 font-bold text-xs">TOTAL GERAL DE REPASSES NO PERÍODO</td>

                    <td className={`p-3.5 text-right font-black text-sm ${isDark ? 'text-slate-100' : 'text-slate-950'}`}>

                      R$ {totalRepasseAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

                    </td>

                  </tr>

                </tfoot>

              </table>

            </div>

          </div>



        </div>

      )}



      {/* ========================================================================= */}

      {/* ABA 3: SÓCIOS DOS 14 CLUBES (100% POCKETBASE)                             */}

      {/* ========================================================================= */}

      {directorSubTab === 'members' && (

        <div className="space-y-6 animate-in fade-in">

          

          <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">

              <div className="flex items-center space-x-2">

                <Filter className="w-4 h-4 text-slate-500 shrink-0" />

                <select

                  value={memberClubFilter}

                  onChange={(e) => {

                    setMemberClubFilter(e.target.value);

                    setMemberPage(1);

                  }}

                  className={`border rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none ${

                    isDark

                      ? 'bg-slate-950 border-slate-800 text-slate-200'

                      : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                  }`}

                >

                  <option value="all">Todos os 14 Clubes SCAER</option>

                  {clubs.map((c) => (

                    <option key={c.id} value={c.id}>

                      {c.name} (R$ {c.monthlyFee.toFixed(2)}/mês)

                    </option>

                  ))}

                </select>

              </div>



              <div className="relative flex-1 md:w-64">

                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />

                <input

                  type="text"

                  placeholder="Buscar por número, nome de guerra..."

                  value={memberSearchQuery}

                  onChange={(e) => {

                    setMemberSearchQuery(e.target.value);

                    setMemberPage(1);

                  }}

                  className={`w-full border rounded-lg pl-9 pr-3 py-1.5 text-xs focus:outline-none ${

                    isDark

                      ? 'bg-slate-950 border-slate-800 text-slate-200'

                      : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                  }`}

                />

              </div>

            </div>



            <div className="flex items-center space-x-2 w-full md:w-auto justify-end">

              <button

                onClick={handleExportMembersXLSX}

                className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                    : 'bg-white border-slate-300 text-slate-800 hover:text-slate-950 hover:bg-slate-100 shadow-sm'

                }`}

              >

                <FileSpreadsheet className="w-4 h-4" />

                <span>Exportar XLSX</span>

              </button>



              <button

                onClick={handleExportMembersPDF}

                className={`px-3.5 py-2 rounded-lg font-semibold text-xs border transition-colors flex items-center space-x-1.5 ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'

                    : 'bg-white border-slate-300 text-slate-800 hover:text-slate-950 hover:bg-slate-100 shadow-sm'

                }`}

              >

                <Download className="w-4 h-4" />

                <span>Exportar PDF</span>

              </button>

            </div>

          </div>



          <div className={`rounded-xl border overflow-hidden transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div className="overflow-x-auto">

              <table className="w-full text-left text-xs">

                <thead className={`font-mono uppercase border-b ${

                  isDark ? 'bg-slate-950 text-slate-400 border-slate-800' : 'bg-slate-100 text-slate-700 font-bold border-slate-300'

                }`}>

                  <tr>

                    <th className="p-3.5">Número e Nome de Guerra</th>

                    <th className="p-3.5">Esquadrão</th>

                    <th className="p-3.5">Clube SCAER</th>

                    <th className="p-3.5">Mensalidade</th>

                    <th className="p-3.5">Status da Adesão</th>

                    <th className="p-3.5">Data de Aprovação</th>

                  </tr>

                </thead>

                <tbody className={`divide-y ${isDark ? 'divide-slate-800/60' : 'divide-slate-200'}`}>

                  {filteredMemberships.length === 0 ? (

                    <tr>

                      <td colSpan={6} className="p-8 text-center text-slate-500 font-medium">

                        Nenhum sócio ativo encontrado para os filtros selecionados.

                      </td>

                    </tr>

                  ) : (

                    filteredMemberships.slice((memberPage - 1) * 35, memberPage * 35).map((m) => {

                      const club = clubs.find((c) => c.id === m.clubId);

                      return (

                        <tr key={m.id} className={`transition-colors ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}`}>

                          <td className={`p-3.5 font-bold font-mono ${isDark ? 'text-slate-100' : 'text-slate-950'}`}>

                            {m.cadetNumber} {m.userName}

                          </td>

                          <td className={`p-3.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                            {m.squadron || '1º Esquadrão'}

                          </td>

                          <td className={`p-3.5 font-semibold ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>

                            {m.clubName || club?.name || 'Clube'}

                          </td>

                          <td className={`p-3.5 font-mono ${isDark ? 'text-slate-300' : 'text-slate-800 font-semibold'}`}>

                            R$ {club ? club.monthlyFee.toFixed(2) : '0.00'}/mês

                          </td>

                          <td className="p-3.5">

                            <span className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border flex items-center space-x-1 w-fit ${

                              isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-800'

                            }`}>

                              <CheckCircle2 className="w-3 h-3 text-slate-500" />

                              <span>Sócio Ativo</span>

                            </span>

                          </td>

                          <td className={`p-3.5 font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>

                            {m.approvedAt || m.requestedAt || '2026-01-01'}

                          </td>

                        </tr>

                      );

                    })

                  )}

                </tbody>

              </table>

            </div>



            <div className={`p-4 border-t flex items-center justify-between text-xs ${

              isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600'

            }`}>

              <span>

                Página {memberPage} de {Math.ceil(filteredMemberships.length / 35) || 1} ({filteredMemberships.length} sócios cadastrados)

              </span>

              <div className="flex items-center space-x-2">

                <button

                  disabled={memberPage === 1}

                  onClick={() => setMemberPage((p) => Math.max(1, p - 1))}

                  className={`px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-30 ${

                    isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'

                  }`}

                >

                  Anterior

                </button>

                <button

                  disabled={memberPage >= Math.ceil(filteredMemberships.length / 35)}

                  onClick={() => setMemberPage((p) => p + 1)}

                  className={`px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-30 ${

                    isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'

                  }`}

                >

                  Próxima

                </button>

              </div>

            </div>



          </div>



        </div>

      )}



      {/* ========================================================================= */}

      {/* ABA 4: LANÇAMENTOS DETALHADOS (AUDITORIA 100% POCKETBASE)                 */}

      {/* ========================================================================= */}

      {directorSubTab === 'audit' && (

        <div className="space-y-6 animate-in fade-in">

          

          <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div className="flex items-center space-x-3 w-full md:w-auto">

              <h3 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>

                Lançamentos Detalhados de Auditoria

              </h3>

              <select

                value={selectedPeriod}

                onChange={(e) => setSelectedPeriod(e.target.value)}

                className={`border rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-200'

                    : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                }`}

              >

                <option value="all">Todos os Meses</option>

                <option value="2026-10">Outubro / 2026 (Prévia)</option>

                <option value="2026-09">Setembro / 2026</option>

                <option value="2026-08">Agosto / 2026</option>

                <option value="2026-07">Julho / 2026</option>

                <option value="2026-06">Junho / 2026</option>

                <option value="2026-05">Maio / 2026</option>

                <option value="2026-04">Abril / 2026</option>

                <option value="2026-03">Março / 2026</option>

                <option value="2026-02">Fevereiro / 2026</option>

                <option value="2026-01">Janeiro / 2026</option>

              </select>

            </div>



            <div className="flex items-center space-x-3 w-full md:w-auto">

              <select

                value={auditClubFilter}

                onChange={(e) => setAuditClubFilter(e.target.value)}

                className={`border rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none ${

                  isDark

                    ? 'bg-slate-950 border-slate-800 text-slate-200'

                    : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                }`}

              >

                <option value="all">Todos os 14 Clubes</option>

                {clubs.map((c) => (

                  <option key={c.id} value={c.id}>{c.name}</option>

                ))}

              </select>



              <div className="relative flex-1 md:w-64">

                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />

                <input

                  type="text"

                  placeholder="Buscar cadete, descrição ou clube..."

                  value={auditSearchQuery}

                  onChange={(e) => setAuditSearchQuery(e.target.value)}

                  className={`w-full border rounded-lg pl-9 pr-3 py-1.5 text-xs focus:outline-none ${

                    isDark

                      ? 'bg-slate-950 border-slate-800 text-slate-200'

                      : 'bg-white border-slate-300 text-slate-900 shadow-sm'

                  }`}

                />

              </div>

            </div>

          </div>



          <div className={`rounded-xl border overflow-hidden transition-colors ${

            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'

          }`}>

            <div className="overflow-x-auto">

              <table className="w-full text-left text-xs">

                <thead className={`font-mono uppercase border-b ${

                  isDark ? 'bg-slate-950 text-slate-400 border-slate-800' : 'bg-slate-100 text-slate-700 font-bold border-slate-300'

                }`}>

                  <tr>

                    <th className="p-3.5">Número e Nome</th>

                    <th className="p-3.5">Clube Emissor</th>

                    <th className="p-3.5">Descrição do Gasto</th>

                    <th className="p-3.5">Categoria</th>

                    <th className="p-3.5">Mês</th>

                    <th className="p-3.5 text-right">Valor (R$)</th>

                    <th className="p-3.5 text-right">Ação</th>

                  </tr>

                </thead>

                <tbody className={`divide-y ${isDark ? 'divide-slate-800/60' : 'divide-slate-200'}`}>

                  {filteredExpenses.length === 0 ? (

                    <tr>

                      <td colSpan={7} className="p-8 text-center text-slate-500 font-medium">

                        Nenhum lançamento detalhado registrado no banco para os filtros selecionados.

                      </td>

                    </tr>

                  ) : (

                    filteredExpenses.slice((auditPage - 1) * 40, auditPage * 40).map((exp) => (

                      <tr key={exp.id} className={`transition-colors ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}`}>

                        <td className={`p-3.5 font-bold font-mono ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>

                          {exp.cadetNumber} {exp.userName}

                        </td>

                        <td className={`p-3.5 font-semibold ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>{exp.clubName}</td>

                        <td className={`p-3.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{exp.description}</td>

                        <td className="p-3.5">

                          <span className={`px-2 py-0.5 rounded text-[10px] border ${

                            isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-800'

                          }`}>

                            {exp.category}

                          </span>

                        </td>

                        <td className={`p-3.5 font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{exp.billingPeriod}</td>

                        <td className={`p-3.5 text-right font-bold font-mono ${isDark ? 'text-slate-100' : 'text-slate-950'}`}>

                          R$ {exp.amount.toFixed(2)}

                        </td>

                        <td className="p-3.5 text-right">

                          <button

                            onClick={() => handleDeleteExpense(exp.id)}

                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-all"

                            title="Excluir Lançamento"

                          >

                            <Trash2 className="w-4 h-4" />

                          </button>

                        </td>

                      </tr>

                    ))

                  )}

                </tbody>

              </table>

            </div>



            <div className={`p-4 border-t flex items-center justify-between text-xs ${

              isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600'

            }`}>

              <span>

                Mostrando página {auditPage} de {Math.ceil(filteredExpenses.length / 40) || 1} ({filteredExpenses.length} lançamentos detalhados)

              </span>

              <div className="flex items-center space-x-2">

                <button

                  disabled={auditPage === 1}

                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}

                  className={`px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-30 ${

                    isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'

                  }`}

                >

                  Anterior

                </button>

                <button

                  disabled={auditPage >= Math.ceil(filteredExpenses.length / 40)}

                  onClick={() => setAuditPage((p) => p + 1)}

                  className={`px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-30 ${

                    isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'

                  }`}

                >

                  Próxima

                </button>

              </div>

            </div>



          </div>

        </div>

      )}



      {showVerifyModal && (

        <ReportVerificationModal reports={reports} onClose={() => setShowVerifyModal(false)} />

      )}



      {/* ========================================================================= */}

      {/* ABA 5: CADASTRO DE EVENTOS                                              */}

      {/* ========================================================================= */}

      {directorSubTab === 'events' && (

        <div className="animate-in fade-in">

          <EventCompanyRegistration theme={theme} />

        </div>

      )}



      {/* ========================================================================= */}

      {/* ABA 6: CONSULTA EVENTOS                                                 */}

      {/* ========================================================================= */}

            {directorSubTab === 'event_query' && (
        <EventLaunchQuery
          periodExpenses={periodExpenses}
          onRefreshData={onRefreshData}
          onExpenseDeleted={(expenseId) => {
            // Remove o lançamento do extrato e dos cadetes em tempo real
            setPeriodExpenses((prev) => prev.filter((e) => e.id !== expenseId));
          }}
          directorUser={directorUser}
          allUsers={allUsers}
          theme={theme}
          selectedPeriod={selectedPeriod}
        />
      )}



      {/* Modal de Lançamento da Diretoria */}

      {showLaunchModal && (

        <LaunchExpenseModal

          club={{ id: 'clb_diretoria', name: 'DIRETORIA DE CÉDULA', monthlyFee: 0, category: 'Diretoria' }}

          activeMembers={[]}

          allCadets={allUsers}

          managerUser={directorUser}

          scannedCadet={scannedCadetInfo}

          onLaunchIndividual={handleLaunchIndividual}

          onLaunchBulk={handleLaunchBulk}

          onClose={() => {

            setShowLaunchModal(false);

            setScannedCadetInfo(null);

          }}

          theme={theme}

        />

      )}



      {/* Scanner QR Code */}

      {showQrScanner && (

        <QRCodeExpenseScanner

          onScanSuccess={(cadetNumber, warName) => {

            setShowQrScanner(false);

            setScannedCadetInfo({ cadetNumber, warName });

            setShowLaunchModal(true);

          }}

          onClose={() => setShowQrScanner(false)}

          theme={theme}

        />

      )}



      {/* Modal de Lançamento EVENTO */}

      {showEventLaunchModal && (

        <LaunchEventExpenseModal

          managerUser={directorUser}

          allCadets={allUsers}

          onLaunchBulk={handleLaunchBulk}

          onClose={() => setShowEventLaunchModal(false)}

          theme={theme}

        />

      )}



    </div>

  );

};

