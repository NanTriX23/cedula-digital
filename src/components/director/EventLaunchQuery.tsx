import React, { useState, useMemo, useEffect } from 'react';
import type { Expense, User } from '../../types';
import { DatabaseService } from '../../lib/pocketbase';
import { generateEventReceiptPDF, generateThermalReceiptPDF } from '../../lib/pdfGenerator';
import {
  Search,
  Trash2,
  Printer,
  ChevronDown,
  ChevronRight,
  Store,
  FileText,
  CheckCircle,
  Ticket,
  RefreshCw,
  Filter,
  Calendar,
} from 'lucide-react';

interface EventLaunchQueryProps {
  periodExpenses: Expense[];
  onRefreshData?: () => void;
  directorUser: User;
  theme?: 'dark' | 'light';
  selectedPeriod: string;
}

export const EventLaunchQuery: React.FC<EventLaunchQueryProps> = ({
  periodExpenses,
  onRefreshData,
  directorUser,
  theme = 'dark',
  selectedPeriod,
}) => {
  const isDark = theme === 'dark';

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCadets, setExpandedCadets] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Dados rápidos em tempo real de eventos
  const [directEventExpenses, setDirectEventExpenses] = useState<Expense[] | null>(null);
  const [registeredEvents, setRegisteredEvents] = useState<string[]>([]);
  const [selectedEventFilter, setSelectedEventFilter] = useState<string>('ALL');

  // Helper para extrair o nome do evento da descrição: "Produto - Empresa (Nome do Evento)"
  const extractEventName = (desc?: string): string => {
    if (!desc) return 'Evento Geral';
    const match = desc.match(/^(.+?)\s*-\s*(.+?)\s*\((.+?)\)(?:\s*\[\d+\/\d+\])?$/) || desc.match(/\(([^)]+)\)/);
    if (match) {
      const extracted = (match[3] || match[1] || '').trim();
      if (extracted && extracted !== 'Evento' && extracted !== 'EVENTO') {
        return extracted;
      }
      return extracted || 'Evento Geral';
    }
    return 'Evento Geral';
  };

  // Carrega transações de eventos diretamente do endpoint ultra-rápido otimizado
  const loadFastEventData = async () => {
    setIsRefreshing(true);
    try {
      const [txs, list] = await Promise.all([
        DatabaseService.getEventTransactions().catch(() => []),
        DatabaseService.getEventList().catch(() => []),
      ]);
      if (txs) {
        setDirectEventExpenses(txs as unknown as Expense[]);
      }
      if (list && list.length > 0) {
        setRegisteredEvents(list);
      }
    } catch (err) {
      console.warn('Erro ao carregar dados rápidos de evento:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadFastEventData();
  }, []);

  // Lista base de gastos de eventos (usa direto do banco ou fallback nas props)
  const allEventExpenses = useMemo(() => {
    if (directEventExpenses !== null) {
      return directEventExpenses;
    }
    return periodExpenses.filter((e) => e.clubId === 'EVENTO' || e.category === 'evento');
  }, [directEventExpenses, periodExpenses]);

  // Lista de eventos disponíveis com contagem e total arrecadado
  const availableEvents = useMemo(() => {
    const statsMap = new Map<string, { count: number; total: number }>();

    allEventExpenses.forEach((exp) => {
      const evName = extractEventName(exp.description);
      const curr = statsMap.get(evName) || { count: 0, total: 0 };
      curr.count += 1;
      curr.total += exp.amount;
      statsMap.set(evName, curr);
    });

    registeredEvents.forEach((ev) => {
      const trimmed = ev.trim();
      if (trimmed && !statsMap.has(trimmed)) {
        statsMap.set(trimmed, { count: 0, total: 0 });
      }
    });

    return Array.from(statsMap.entries()).sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return a[0].localeCompare(b[0]);
    });
  }, [allEventExpenses, registeredEvents]);

  // Filtra apenas gastos do evento selecionado
  const eventExpenses = useMemo(() => {
    if (selectedEventFilter === 'ALL') {
      return allEventExpenses;
    }
    return allEventExpenses.filter((e) => extractEventName(e.description) === selectedEventFilter);
  }, [allEventExpenses, selectedEventFilter]);

  // Agrupa por Cadete e por Pedidos
  const groupedByCadet = useMemo(() => {
    const map = new Map<string, {
      cadetId: string;
      cadetNumber: string;
      cadetName: string;
      totalAmount: number;
      totalItems: number;
      orders: {
        id: string;
        formattedTime: string;
        totalAmount: number;
        expenses: Expense[];
      }[];
    }>();

    eventExpenses.forEach((exp) => {
      const key = exp.cadetNumber || exp.userId || exp.id || '';
      if (!map.has(key)) {
        map.set(key, {
          cadetId: exp.userId || '',
          cadetNumber: exp.cadetNumber || '',
          cadetName: exp.userName || 'Cadete Desconhecido',
          totalAmount: 0,
          totalItems: 0,
          orders: [],
        });
      }
      const group = map.get(key)!;
      group.totalAmount += exp.amount;
      group.totalItems += 1;

      // Agrupar por "Pedido" usando a data/hora até o minuto (ex: 2026-09-19 19:10)
      const timeStr = exp.created ? exp.created.substring(0, 16) : 'unknown';
      let order = group.orders.find((o) => o.id === timeStr);
      if (!order) {
        order = {
          id: timeStr,
          formattedTime: exp.created ? new Date(exp.created).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '---',
          totalAmount: 0,
          expenses: [],
        };
        group.orders.push(order);
      }
      order.expenses.push(exp);
      order.totalAmount += exp.amount;
    });

    const result = Array.from(map.values()).sort((a, b) => a.cadetNumber.localeCompare(b.cadetNumber, undefined, { numeric: true }));
    // Ordenar pedidos do mais recente pro mais antigo
    result.forEach((g) => {
      g.orders.sort((a, b) => b.id.localeCompare(a.id));
    });
    return result;
  }, [eventExpenses]);

  // Totais por Empresa
  const companyTotals = useMemo(() => {
    const map = new Map<string, number>();
    eventExpenses.forEach((exp) => {
      const company = exp.clubName || 'Evento (Geral)';
      map.set(company, (map.get(company) || 0) + exp.amount);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [eventExpenses]);

  // Filtra os Cadetes
  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return groupedByCadet;
    const q = searchQuery.toLowerCase();
    return groupedByCadet.filter((c) =>
      c.cadetNumber.toLowerCase().includes(q) ||
      c.cadetName.toLowerCase().includes(q)
    );
  }, [groupedByCadet, searchQuery]);

  const toggleExpand = (cadetNumber: string) => {
    setExpandedCadets((prev) => {
      const next = new Set(prev);
      if (next.has(cadetNumber)) next.delete(cadetNumber);
      else next.add(cadetNumber);
      return next;
    });
  };

  const handleDelete = async (expense: Expense) => {
    if (!window.confirm(`Tem certeza que deseja excluir o item "${expense.description}" no valor de R$ ${expense.amount.toFixed(2)}?\n\nIsso removerá a cobrança permanentemente da cédula do cadete.`)) {
      return;
    }

    setIsDeleting(expense.id);
    try {
      const success = await DatabaseService.deleteTransaction(expense.id);
      if (success) {
        if (directEventExpenses) {
          setDirectEventExpenses((prev) => (prev ? prev.filter((e) => e.id !== expense.id) : null));
        }
        if (onRefreshData) onRefreshData();
      } else {
        alert('Erro ao excluir o lançamento. Verifique sua conexão.');
      }
    } catch (err) {
      console.error(err);
      alert('Erro inesperado ao excluir o lançamento.');
    } finally {
      setIsDeleting(null);
    }
  };

  const handlePrintReceipt = async (group: typeof groupedByCadet[0]) => {
    setIsGeneratingPdf(group.cadetId);
    try {
      const allExpenses = group.orders.flatMap((o) => o.expenses);
      const { pdfUrl } = await generateEventReceiptPDF({
        cadetNumber: group.cadetNumber,
        cadetName: group.cadetName,
        period: selectedPeriod,
        expenses: allExpenses,
        director: directorUser,
      });
      window.open(pdfUrl, '_blank');
    } catch (err) {
      console.error(err);
      alert('Erro ao gerar o PDF do recibo.');
    } finally {
      setIsGeneratingPdf(null);
    }
  };

  const handlePrintThermalOrder = async (group: typeof groupedByCadet[0], order: typeof groupedByCadet[0]['orders'][0]) => {
    setIsGeneratingPdf(order.id + '-thermal');
    try {
      const { pdfUrl } = await generateThermalReceiptPDF({
        cadetNumber: group.cadetNumber,
        cadetName: group.cadetName,
        period: selectedPeriod,
        expenses: order.expenses,
        director: directorUser,
      });
      window.open(pdfUrl, '_blank');
    } catch (err) {
      console.error(err);
      alert('Erro ao gerar o PDF térmico.');
    } finally {
      setIsGeneratingPdf(null);
    }
  };

  const handlePrintGeneralPDF = async () => {
    if (eventExpenses.length === 0) {
      alert('Nenhum lançamento no evento selecionado para gerar o extrato.');
      return;
    }
    setIsGeneratingPdf('general-event-report');
    try {
      const eventLabel = selectedEventFilter === 'ALL' ? 'CONSOLIDADO DE TODOS OS EVENTOS' : `EVENTO: ${selectedEventFilter}`;
      const { pdfUrl } = await generateEventReceiptPDF({
        cadetNumber: 'GERAL',
        cadetName: eventLabel,
        period: selectedPeriod,
        expenses: eventExpenses,
        director: directorUser,
      });
      window.open(pdfUrl, '_blank');
    } catch (err) {
      console.error(err);
      alert('Erro ao gerar o extrato geral do evento.');
    } finally {
      setIsGeneratingPdf(null);
    }
  };

  const grandTotal = eventExpenses.reduce((acc, curr) => acc + curr.amount, 0);

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* SELETOR DE EVENTO & BOTÕES DE CONTROLE */}
      <div className={`p-4 rounded-xl border transition-colors ${
        isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
          <div className="flex items-center space-x-2">
            <Filter className={`w-4 h-4 ${isDark ? 'text-orange-400' : 'text-orange-600'}`} />
            <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              Filtrar por Evento:
            </h4>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={loadFastEventData}
              disabled={isRefreshing}
              title="Recarregar lançamentos em tempo real"
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                isDark
                  ? 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                  : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-orange-400' : ''}`} />
              <span>{isRefreshing ? 'Atualizando...' : 'Recarregar'}</span>
            </button>

            <button
              onClick={handlePrintGeneralPDF}
              disabled={isGeneratingPdf !== null || eventExpenses.length === 0}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                isDark
                  ? 'bg-orange-500 text-slate-950 hover:bg-orange-400'
                  : 'bg-orange-500 text-white hover:bg-orange-600'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isGeneratingPdf === 'general-event-report' ? 'Gerando...' : 'Extrato Geral (PDF)'}</span>
            </button>
          </div>
        </div>

        {/* Chips de Seleção de Eventos */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => setSelectedEventFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 border ${
              selectedEventFilter === 'ALL'
                ? isDark
                  ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                  : 'bg-orange-500 text-white border-orange-600 shadow-sm'
                : isDark
                  ? 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
            }`}
          >
            <span>🎯</span>
            <span>Todos os Eventos ({allEventExpenses.length})</span>
          </button>

          {availableEvents.map(([eventName, stats]) => {
            const isSelected = selectedEventFilter === eventName;
            return (
              <button
                key={eventName}
                type="button"
                onClick={() => setSelectedEventFilter(eventName)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 border ${
                  isSelected
                    ? isDark
                      ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-sm'
                      : 'bg-orange-500 text-white border-orange-600 shadow-sm'
                    : isDark
                      ? 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
                      : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                }`}
              >
                <Calendar className="w-3 h-3" />
                <span>{eventName}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isSelected ? 'bg-black/20 text-white' : isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600'
                }`}>
                  {stats.count} itens · R$ {stats.total.toFixed(0)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Header Resumo */}
      <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
        isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg border ${
            isDark ? 'bg-slate-950 border-slate-800 text-orange-400' : 'bg-orange-50 border-orange-200 text-orange-600'
          }`}>
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className={`text-sm font-bold uppercase tracking-wider ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {selectedEventFilter === 'ALL' ? 'Consulta Geral: Todos os Eventos' : `Evento: ${selectedEventFilter}`}
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {filteredList.length} cadete(s) comprador(es) · {eventExpenses.length} item(ns) lançados
            </p>
          </div>
        </div>

        <div className={`px-4 py-2 rounded-xl border text-right ${
          isDark ? 'bg-orange-500/10 border-orange-500/20' : 'bg-orange-50 border-orange-200'
        }`}>
          <div className={`text-[10px] font-bold ${isDark ? 'text-orange-400/80' : 'text-orange-600/80'}`}>
            {selectedEventFilter === 'ALL' ? 'TOTAL GERAL (TODOS OS EVENTOS)' : `TOTAL ARRECADADO (${selectedEventFilter.toUpperCase()})`}
          </div>
          <div className={`text-lg font-extrabold font-mono ${isDark ? 'text-orange-400' : 'text-orange-700'}`}>
            R$ {grandTotal.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Arrecadação por Empresa */}
      {companyTotals.length > 0 && (
        <div className={`p-4 rounded-xl border transition-colors ${
          isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Arrecadação por Empresa / Fornecedor (A repassar)
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {companyTotals.map(([companyName, total]) => (
              <div key={companyName} className={`p-3 rounded-lg border ${
                isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className={`text-[10px] font-bold truncate mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`} title={companyName}>
                  {companyName}
                </div>
                <div className={`font-mono font-bold text-sm ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>
                  R$ {total.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Busca */}
      <div className={`flex items-center w-full border rounded-xl overflow-hidden transition-all ${
        isDark ? 'bg-slate-950 border-slate-800 focus-within:border-slate-700' : 'bg-white border-slate-300 focus-within:border-slate-400'
      }`}>
        <Search className={`w-4 h-4 ml-4 shrink-0 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
        <input
          type="text"
          placeholder="Buscar pedidos por nome do cadete ou número de matrícula..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={`w-full px-3 py-3 text-xs font-semibold focus:outline-none bg-transparent ${
            isDark ? 'text-slate-100 placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'
          }`}
        />
      </div>

      {/* Lista de Pedidos */}
      {filteredList.length === 0 ? (
        <div className={`text-center py-12 rounded-xl border ${
          isDark ? 'bg-slate-900/50 border-slate-800 text-slate-500' : 'bg-slate-50 border-slate-200 text-slate-400'
        }`}>
          <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold">Nenhum pedido de evento encontrado com o filtro atual.</p>
          <p className="text-xs mt-1">Selecione outro evento ou termo de busca.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredList.map((group) => {
            const isExpanded = expandedCadets.has(group.cadetNumber);
            return (
              <div
                key={group.cadetId || group.cadetNumber}
                className={`rounded-xl border overflow-hidden transition-colors ${
                  isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                {/* Cabeçalho do Pedido (Cadete) */}
                <div
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                    isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => toggleExpand(group.cadetNumber)}
                >
                  <div className="flex items-center space-x-3">
                    {isExpanded ? (
                      <ChevronDown className={`w-4 h-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                    ) : (
                      <ChevronRight className={`w-4 h-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                    )}
                    
                    <span className={`font-mono font-bold text-xs ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>
                      {group.cadetNumber}
                    </span>
                    <span className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      {group.cadetName}
                    </span>
                    
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {group.totalItems} item(ns)
                    </span>
                  </div>

                  <div className="flex items-center space-x-4" onClick={(e) => e.stopPropagation()}>
                    <span className={`font-mono font-extrabold text-sm ${isDark ? 'text-orange-400' : 'text-orange-700'}`}>
                      R$ {group.totalAmount.toFixed(2)}
                    </span>
                    
                    <button
                      onClick={() => handlePrintReceipt(group)}
                      disabled={isGeneratingPdf !== null}
                      title="Imprimir A4/PDF deste evento para o cadete"
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                        isGeneratingPdf === group.cadetId
                          ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                          : isDark
                            ? 'bg-orange-500 text-slate-950 hover:bg-orange-400'
                            : 'bg-orange-500 text-white hover:bg-orange-600'
                      }`}
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>{isGeneratingPdf === group.cadetId ? 'Gerando...' : 'A4'}</span>
                    </button>
                  </div>
                </div>

                {/* Detalhes Expandidos (Pedidos) */}
                {isExpanded && (
                  <div className={`border-t p-4 space-y-4 ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                    {group.orders.map((order, i) => (
                      <div key={order.id} className={`rounded-xl border overflow-hidden ${isDark ? 'border-slate-800 bg-slate-950/30' : 'border-slate-200 bg-slate-50/50'}`}>
                        {/* Header do Pedido */}
                        <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-200 bg-white'}`}>
                          <div className="flex items-center space-x-2">
                            <span className={`text-xs font-extrabold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                              Pedido {group.orders.length - i}
                            </span>
                            <span className={`text-[10px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                              {order.formattedTime}
                            </span>
                          </div>
                          
                          <div className="flex items-center space-x-3">
                            <span className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                              R$ {order.totalAmount.toFixed(2)}
                            </span>
                            <button
                              onClick={() => handlePrintThermalOrder(group, order)}
                              disabled={isGeneratingPdf !== null}
                              title="Imprimir Notinha Térmica (Impressora 58mm)"
                              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-[9px] font-bold transition-all border ${
                                isGeneratingPdf === order.id + '-thermal'
                                  ? 'bg-amber-100 border-amber-200 text-amber-400 cursor-not-allowed'
                                  : isDark
                                    ? 'bg-amber-900/30 border-amber-500/30 text-amber-400 hover:bg-amber-900/50'
                                    : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                              }`}
                            >
                              <Ticket className="w-3 h-3" />
                              <span>{isGeneratingPdf === order.id + '-thermal' ? 'Ger...' : 'Térmica'}</span>
                            </button>
                          </div>
                        </div>

                        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                          {order.expenses.map((exp) => (
                            <div key={exp.id} className={`flex items-center px-4 py-2.5 text-xs transition-colors ${
                              isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/80'
                            }`}>
                              <div className="flex-1 flex items-center space-x-2">
                                <CheckCircle className={`w-3.5 h-3.5 ${isDark ? 'text-emerald-500/50' : 'text-emerald-500'}`} />
                                <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{exp.description}</span>
                              </div>
                              
                              <div className={`w-24 text-right font-mono font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                                R$ {exp.amount.toFixed(2)}
                              </div>
                              
                              <div className="w-10 flex justify-end pl-2">
                                <button
                                  onClick={() => handleDelete(exp)}
                                  disabled={isDeleting === exp.id}
                                  title="Excluir este item"
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    isDeleting === exp.id
                                      ? 'opacity-50 cursor-not-allowed'
                                      : isDark
                                        ? 'hover:bg-red-500/20 text-slate-500 hover:text-red-400'
                                        : 'hover:bg-red-50 text-slate-400 hover:text-red-500'
                                  }`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
