import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { Expense, User } from '../types';

export interface GeneratePdfOptions {
  period: string;
  director: User;
  expenses: Expense[];
  totalAmount: number;
  totalLaunches: number;
  totalCadets: number;
  verificationHash: string;
  reportType: 'synthetic' | 'detailed'; // Sintético (Soma por Cadete) ou Detalhado
}

// Helper para gerar SHA-256 Hash
export async function generateSHA256(text: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateDirectorPDFReport(options: GeneratePdfOptions): Promise<{ pdfBlob: Blob; pdfUrl: string; hash: string }> {
  const { period, director, expenses, totalAmount, totalLaunches, totalCadets, verificationHash, reportType } = options;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const [year, month] = period.split('-');
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const monthTitle = `${monthNames[parseInt(month, 10) - 1] || month} / ${year}`;
  const nowFormatted = new Date().toLocaleString('pt-BR');
  const pageWidth = doc.internal.pageSize.getWidth();

  // --- CABEÇALHO INSTITUCIONAL DA CÉDULA ---
  doc.setFillColor(15, 23, 42); // Navy Dark
  doc.rect(0, 0, pageWidth, 42, 'F');

  // Faixa Dourada
  doc.setFillColor(217, 119, 6); // Gold #D97706
  doc.rect(0, 41, pageWidth, 1.5, 'F');

  // Textos do Cabeçalho
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('SOCIEDADE ACADÊMICA DOS CADETES DA AERONÁUTICA (SCAER)', 14, 15);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  const modeTitle = reportType === 'synthetic' ? 'RELATÓRIO SINTÉTICO (SOMATÓRIO POR CADETE)' : 'RELATÓRIO DETALHADO DE LANÇAMENTOS';
  doc.text(`DIRETORIA DE CÉDULA - ${modeTitle} - PERÍODO: ${monthTitle.toUpperCase()}`, 14, 23);

  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Diretor Responsável: ${director.cadetNumber} ${director.warName} (${director.name})`, 14, 31);
  doc.text(`Data da Emissão: ${nowFormatted}`, 14, 36);

  // --- RESUMO EXECUTIVO ---
  let currentY = 50;

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(14, currentY, 56, 22, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('TOTAL CONSOLIDADO CÉDULA', 18, currentY + 6);
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`R$ ${totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 18, currentY + 16);

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(77, currentY, 56, 22, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('TOTAL DE REGISTROS', 81, currentY + 6);
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`${totalLaunches} lançamentos`, 81, currentY + 16);

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(140, currentY, 56, 22, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('CADETES ENVOLVIDOS', 144, currentY + 6);
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`${totalCadets} cadetes`, 144, currentY + 16);

  currentY += 30;

  // --- CONTEÚDO DA TABELA DEPENDENDO DO TIPO (SINTÉTICO OU DETALHADO) ---
  if (reportType === 'synthetic') {
    // Agrupar gastos por Cadete (Número e Nome)
    const cadetTotalsMap: { [key: string]: { name: string; number: string; total: number; count: number } } = {};

    expenses.forEach((exp) => {
      const cadetName = exp.userName || exp.cadetName || 'Cadete';
      const key = `${exp.cadetNumber}_${cadetName}`;
      if (!cadetTotalsMap[key]) {
        cadetTotalsMap[key] = {
          number: exp.cadetNumber,
          name: cadetName,
          total: 0,
          count: 0
        };
      }
      cadetTotalsMap[key].total += exp.amount;
      cadetTotalsMap[key].count += 1;
    });

    const cadetTotalsList = Object.values(cadetTotalsMap);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Somatório Consolidado de Cédula por Cadete', 14, currentY);

    currentY += 5;

    // Cabeçalho da Tabela Sintética
    doc.setFillColor(30, 41, 59);
    doc.rect(14, currentY, 182, 8, 'F');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('Número e Nome do Cadete (XX/XXX NOME)', 18, currentY + 5.5);
    doc.text('Qtd. Lançamentos', 120, currentY + 5.5);
    doc.text('Valor Total Cédula', 165, currentY + 5.5);

    currentY += 8;

    cadetTotalsList.forEach((cItem, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(14, currentY, 182, 7, 'F');
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(`${cItem.number} ${cItem.name}`, 18, currentY + 4.8);

      doc.setFont('helvetica', 'normal');
      doc.text(`${cItem.count} itens`, 120, currentY + 4.8);

      doc.setFont('helvetica', 'bold');
      doc.text(`R$ ${cItem.total.toFixed(2)}`, 165, currentY + 4.8);

      currentY += 7;
    });
  } else {
    // Tabela Detalhada
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Detalhamento Completo de Lançamentos na Cédula', 14, currentY);

    currentY += 5;

    doc.setFillColor(30, 41, 59);
    doc.rect(14, currentY, 182, 8, 'F');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('Cadete (XX/XXX FULANO)', 18, currentY + 5.5);
    doc.text('Clube Emissor', 65, currentY + 5.5);
    doc.text('Descrição do Gasto', 105, currentY + 5.5);
    doc.text('Valor', 175, currentY + 5.5);

    currentY += 8;

    const displayExps = expenses.slice(0, 14);
    displayExps.forEach((exp, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(14, currentY, 182, 7, 'F');
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      doc.text(`${exp.cadetNumber} ${exp.userName}`, 18, currentY + 4.8);

      doc.setFont('helvetica', 'normal');
      doc.text(exp.clubName.substring(0, 22), 65, currentY + 4.8);
      doc.text(exp.description.substring(0, 32), 105, currentY + 4.8);

      doc.setFont('helvetica', 'bold');
      doc.text(`R$ ${exp.amount.toFixed(2)}`, 175, currentY + 4.8);

      currentY += 7;
    });
  }

  // --- SEÇÃO DE ASSINATURA DIGITAL E SELO OFICIAL DA DIRETORIA DE CÉDULA ---
  const stampY = 205;

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(250, 250, 250);
  doc.roundedRect(14, stampY, 182, 70, 4, 4, 'FD');

  const qrDataUrl = await QRCode.toDataURL(`https://scaer.fab.mil.br/verify?hash=${verificationHash}`, {
    margin: 1,
    width: 120,
    color: { dark: '#0F172A', light: '#FFFFFF' }
  });

  doc.addImage(qrDataUrl, 'PNG', 18, stampY + 8, 30, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('VALIDAÇÃO DE AUTENTICIDADE E ASSINATURA DIGITAL', 52, stampY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text('Este documento oficial foi assinado eletronicamente pela Diretoria de Cédula da SCAER.', 52, stampY + 20);
  doc.text('Escaneie o QR Code ao lado para checar a integridade do selo no portal institucional.', 52, stampY + 24);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(30, 58, 138);
  doc.text(`HASH SHA-256: ${verificationHash}`, 52, stampY + 31);

  // --- SELO/CARIMBO OFICIAL VISUAL DA DIRETORIA DE CÉDULA ---
  const sealCenterX = 168;
  const sealCenterY = stampY + 24;

  doc.setDrawColor(217, 119, 6); // Dourado
  doc.setLineWidth(0.8);
  doc.circle(sealCenterX, sealCenterY, 15, 'S');

  doc.setDrawColor(30, 58, 138); // Azul Marinho
  doc.setLineWidth(0.4);
  doc.circle(sealCenterX, sealCenterY, 13.2, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(217, 119, 6);
  doc.text('★ DIRETORIA DE CÉDULA ★', sealCenterX - 12.5, sealCenterY - 6);

  doc.setFontSize(6);
  doc.setTextColor(15, 23, 42);
  doc.text('SCAER', sealCenterX - 4.5, sealCenterY - 1);
  doc.text('AUTÊNTICO', sealCenterX - 7.5, sealCenterY + 3);

  doc.setFontSize(4.5);
  doc.setTextColor(16, 185, 129);
  doc.text('ASSINADO DIGITAL', sealCenterX - 9, sealCenterY + 7);

  // Assinatura do Diretor
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(52, stampY + 54, 140, stampY + 54);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`${director.cadetNumber} ${director.warName}`.toUpperCase(), 52, stampY + 59);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Diretor de Cédula - Sociedade Acadêmica dos Cadetes da Aeronáutica`, 52, stampY + 63);

  const pdfBlob = doc.output('blob');
  const pdfUrl = URL.createObjectURL(pdfBlob);

  return {
    pdfBlob,
    pdfUrl,
    hash: verificationHash
  };
}

// ==========================================
// RECIBO DE EVENTO (INDIVIDUAL)
// ==========================================

export interface EventReceiptOptions {
  cadetNumber: string;
  cadetName: string;
  period: string;
  expenses: Expense[];
  director: User;
}

export async function generateEventReceiptPDF(options: EventReceiptOptions): Promise<{ pdfBlob: Blob; pdfUrl: string }> {
  const { cadetNumber, cadetName, period, expenses, director } = options;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Agrupar produtos iguais
  const productMap = new Map<string, { count: number; unitPrice: number; company: string; category: string }>();
  let grandTotal = 0;

  expenses.forEach(exp => {
    // A descrição do produto vem no formato: "Produto - Empresa (Evento) [1/3]" ou "Produto - Empresa (Evento)"
    let desc = exp.description;
    const match = desc.match(/^(.+?)\s*-\s*(.+?)\s*\((.+?)\)(?:\s*\[\d+\/\d+\])?$/) || desc.match(/(.+) - (.+) \((.+)\)/);
    let productName = desc;
    let companyName = exp.clubName || 'Evento';

    if (match) {
      productName = match[1].trim();
      companyName = match[2].trim();
    }

    const key = `${productName}|${companyName}|${exp.amount}`;
    
    if (!productMap.has(key)) {
      productMap.set(key, { count: 0, unitPrice: exp.amount, company: companyName, category: exp.category });
    }
    
    productMap.get(key)!.count += 1;
    grandTotal += exp.amount;
  });

  const groupedProducts = Array.from(productMap.entries()).map(([key, data]) => {
    const [name] = key.split('|');
    return { name, ...data };
  });

  // Estilos de Cabeçalho
  doc.setFillColor(15, 23, 42); // Navy Dark
  doc.rect(0, 0, pageWidth, 42, 'F');
  
  doc.setFillColor(249, 115, 22); // Orange (Evento)
  doc.rect(0, 41, pageWidth, 1.5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('CÉDULA DIGITAL SCAER', 14, 18);
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('RECIBO DE EVENTO', 14, 25);
  doc.text(`Período de Referência: ${period}`, 14, 31);
  
  doc.setFontSize(8);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - 14, 31, { align: 'right' });

  // Dados do Cadete
  let currentY = 55;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`Cadete: ${cadetNumber} ${cadetName}`, 14, currentY);
  
  currentY += 12;

  // Cabeçalho da Tabela
  doc.setFillColor(30, 41, 59);
  doc.rect(14, currentY, 182, 8, 'F');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('Produto / Descrição', 18, currentY + 5.5);
  doc.text('Empresa', 90, currentY + 5.5);
  doc.text('Qtd.', 135, currentY + 5.5);
  doc.text('Total', 165, currentY + 5.5);

  currentY += 8;

  // Itens da Tabela
  groupedProducts.forEach((item, idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, currentY, 182, 7, 'F');
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    
    // Nome com fallback se muito longo
    let displayName = item.name;
    if (displayName.length > 40) displayName = displayName.slice(0, 37) + '...';
    doc.text(displayName, 18, currentY + 4.8);

    doc.setFont('helvetica', 'normal');
    doc.text(item.company, 90, currentY + 4.8);
    doc.text(`${item.count}x`, 135, currentY + 4.8);

    doc.setFont('helvetica', 'bold');
    const rowTotal = item.unitPrice * item.count;
    doc.text(`R$ ${rowTotal.toFixed(2)}`, 165, currentY + 4.8);

    currentY += 7;
  });

  // Linha de Totalizador
  currentY += 5;
  doc.setFillColor(249, 115, 22);
  doc.rect(14, currentY, 182, 10, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text('VALOR TOTAL DO PEDIDO:', 18, currentY + 6.5);
  doc.text(`R$ ${grandTotal.toFixed(2)}`, 165, currentY + 6.5);

  // Assinatura do Diretor Responsável (Rodapé)
  const stampY = 240;
  
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(52, stampY, 140, stampY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`${director.cadetNumber} ${director.warName}`.toUpperCase(), 52, stampY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Diretor de Cédula (Resp. Evento)`, 52, stampY + 9);

  const pdfBlob = doc.output('blob');
  const pdfUrl = URL.createObjectURL(pdfBlob);

  return { pdfBlob, pdfUrl };
}

// ==========================================
// ==========================================
// RECIBO TÉRMICO (BOBINA 58mm)
// ==========================================

export async function generateThermalReceiptPDF(options: EventReceiptOptions): Promise<{ pdfBlob: Blob; pdfUrl: string }> {
  const { cadetNumber, cadetName, expenses } = options;

  // Agrupar por Empresa -> array de expenses (cada um é 1 unidade individual)
  const companyMap = new Map<string, Expense[]>();

  expenses.forEach(exp => {
    let companyName = exp.clubName || 'Evento';
    const match = exp.description?.match(/^(.+?)\s*-\s*(.+?)\s*\((.+?)\)(?:\s*\[\d+\/\d+\])?$/) || exp.description?.match(/(.+) - (.+) \((.+)\)/);
    if (match) {
      companyName = match[2].trim();
    }

    if (!companyMap.has(companyName)) {
      companyMap.set(companyName, []);
    }
    companyMap.get(companyName)!.push(exp);
  });

  const groupedByCompany = Array.from(companyMap.entries()).map(([company, exps]) => ({
     company,
     expenses: exps
  }));

  const itemHeight = 24; // mm de altura para cada vale de produto

  // Cálculo exato da altura da bobina
  let calcY = 8;
  groupedByCompany.forEach((group, groupIndex) => {
    calcY += 10.5; // Header loja + data/cad + linha pontilhada
    group.expenses.forEach((_, expIndex) => {
      calcY += itemHeight;
      if (expIndex < group.expenses.length - 1 || groupIndex < groupedByCompany.length - 1) {
        calcY += 4;
      }
    });
  });
  const docHeight = Math.ceil(calcY + 25); // 25mm margem final de avanço da serrilha

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [58, docHeight]
  });

  // Fundo amarelado suave característico de bobina térmica
  doc.setFillColor(254, 252, 232);
  doc.rect(0, 0, 58, docHeight, 'F');

  doc.setTextColor(0, 0, 0); // Preto puro para máxima legibilidade

  let y = 8;
  const shortCadetName = cadetName ? cadetName.substring(0, 20) : '';

  groupedByCompany.forEach((group, groupIndex) => {
    // 1. Cabeçalho da Empresa / Loja
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    let comp = group.company.trim();
    doc.text(`LOJA: ${comp}`, 29, y, { align: 'center' });
    y += 4.5;

    // 2. Informações de Data e Cadete
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const dateStr = new Date().toLocaleString('pt-BR');
    doc.text(`Data: ${dateStr}  ·  Cad: ${cadetNumber} ${shortCadetName}`, 29, y, { align: 'center' });
    y += 4;

    // Linha pontilhada de corte logo após o cabeçalho
    doc.setLineDashPattern([1.5, 1], 0);
    doc.setLineWidth(0.3);
    doc.line(4, y, 54, y);
    y += 2;

    // 3. Vales de Produtos (Itens)
    group.expenses.forEach((exp, expIndex) => {
      let desc = exp.description || '';
      const match = desc.match(/^(.+?)\s*-\s*(.+?)\s*\((.+?)\)(?:\s*\[\d+\/\d+\])?$/) || desc.match(/(.+) - (.+) \((.+)\)/);
      let productName = desc;
      if (match) productName = match[1].trim();

      const boxTop = y;
      const boxCenterY = boxTop + (itemHeight / 2);

      // Tipografia do Produto: Sans-serif (Helvetica), Negrito
      doc.setFont('helvetica', 'bold');
      let fontSize = 12;
      doc.setFontSize(fontSize);
      let lines = doc.splitTextToSize(productName, 48);

      // Se o nome for longo e vazar para mais de 2 linhas, ajusta a fonte proporcionalmente
      if (lines.length > 2) {
        fontSize = 10;
        doc.setFontSize(fontSize);
        lines = doc.splitTextToSize(productName, 48);
      }
      if (lines.length > 2) {
        fontSize = 9;
        doc.setFontSize(fontSize);
        lines = doc.splitTextToSize(productName, 48);
      }

      // Centralização vertical e horizontal perfeita no espaço do vale
      const lineHeight = fontSize === 12 ? 5 : 4.2;
      const totalTextHeight = (lines.length - 1) * lineHeight;
      const startTextY = boxCenterY - (totalTextHeight / 2) + 1.2;

      lines.forEach((line: string, idx: number) => {
        doc.text(line, 29, startTextY + (idx * lineHeight), { align: 'center' });
      });

      y = boxTop + itemHeight;

      // Linha de corte pontilhada separando este vale do próximo
      doc.setLineDashPattern([1.5, 1], 0);
      doc.setLineWidth(0.3);
      doc.line(4, y, 54, y);

      if (expIndex < group.expenses.length - 1 || groupIndex < groupedByCompany.length - 1) {
        y += 4;
      }
    });
  });

  const pdfBlob = doc.output('blob');
  const pdfUrl = URL.createObjectURL(pdfBlob);

  return { pdfBlob, pdfUrl };
}
