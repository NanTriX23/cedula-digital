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

  doc.autoPrint();
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

  doc.autoPrint();
  const pdfBlob = doc.output('blob');
  const pdfUrl = URL.createObjectURL(pdfBlob);

  return { pdfBlob, pdfUrl };
}

// ==========================================
// RECIBO TÉRMICO (BOBINA 58mm)
// Layout alinhado ao padrão de vales de evento (vouchers destacados)
// ==========================================

const EAGLE_EMOJI_BASE64 = "data:image/png;base64,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";

export async function generateThermalReceiptPDF(options: EventReceiptOptions): Promise<{ pdfBlob: Blob; pdfUrl: string }> {
  const { cadetNumber, cadetName, expenses } = options;

  // Cada despesa é 1 vale individual de produto
  const itemHeight = 26; // mm de altura para cada vale de produto

  // Cálculo dinâmico da altura total da bobina
  let calcY = 4;
  const hasHeader = Boolean(cadetNumber || cadetName);
  if (hasHeader) {
    calcY += 18; // espaço para ícone da águia/harpia + cabeçalho em 2 linhas + linha divisória
  }

  // Altura dos vales (itens)
  calcY += expenses.length * itemHeight;

  // 8mm de margem final de avanço de papel para serrilha da impressora (sem desperdício de papel)
  const docHeight = Math.ceil(calcY + 8);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [58, docHeight]
  });

  // Fundo totalmente branco e texto 100% preto puro (sem cinzas/dithering para impressora térmica)
  doc.setTextColor(0, 0, 0);

  let y = 4;
  const shortCadetName = cadetName ? cadetName.trim() : '';

  // 1. Cabeçalho discreto no topo (Apenas 1x para toda a compra)
  if (hasHeader) {
    // Símbolo da turma (Harpia / Águia) centralizado no topo
    try {
      doc.addImage(EAGLE_EMOJI_BASE64, 'PNG', 25.5, y, 7, 7);
      y += 8.2;
    } catch (e) {
      // prossegue normalmente se imagem não renderizar
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    const cadetInfo = [cadetNumber, shortCadetName].filter(Boolean).join(' ');
    doc.text(`Cad: ${cadetInfo}`, 29, y, { align: 'center' });
    y += 3.6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const dateStr = new Date().toLocaleString('pt-BR');
    doc.text(dateStr, 29, y, { align: 'center' });
    y += 3.2;

    // Linha pontilhada de corte logo após o cabeçalho (largura segura de 42mm: de 8mm a 50mm)
    doc.setLineDashPattern([1.5, 1], 0);
    doc.setLineWidth(0.25);
    doc.line(8, y, 50, y);
  }

  // 2. Vales de Produtos (Itens individuais)
  expenses.forEach((exp) => {
    let desc = exp.description || '';
    const match = desc.match(/^(.+?)\s*-\s*(.+?)\s*\((.+?)\)(?:\s*\[\d+\/\d+\])?$/) || desc.match(/(.+) - (.+) \((.+)\)/);
    let productName = desc;
    let companyName = (exp.clubName && exp.clubName !== 'Evento') ? exp.clubName : '';
    if (match) {
      productName = match[1].trim();
      if (!companyName) {
        companyName = match[2].trim();
      }
    }

    const boxTop = y;
    const boxCenterY = boxTop + (itemHeight / 2);

    // Tipografia do Produto: Sans-serif (Helvetica), Negrito
    // Largura máxima segura: 38mm (para impressoras 58mm cujo cabeçote térmico útil é 44-48mm)
    const maxSafeWidth = 38;
    let fontSize = 11;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    let lines = doc.splitTextToSize(productName, maxSafeWidth);

    // Se o nome for muito longo e passar de 2 linhas, reduz o tamanho para caber perfeitamente
    if (lines.length > 2) {
      fontSize = 9.5;
      doc.setFontSize(fontSize);
      lines = doc.splitTextToSize(productName, maxSafeWidth);
    }
    if (lines.length > 2) {
      fontSize = 8.5;
      doc.setFontSize(fontSize);
      lines = doc.splitTextToSize(productName, maxSafeWidth);
    }

    const productLineHeight = fontSize >= 11 ? 4.5 : (fontSize >= 9.5 ? 4.0 : 3.5);
    const companyGap = 3.8;
    const totalBlockHeight = ((lines.length - 1) * productLineHeight) + (companyName ? companyGap : 0);
    const startProductY = boxCenterY - (totalBlockHeight / 2) + 0.6;

    // Renderiza o Nome do Produto (em negrito, preto puro)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.setTextColor(0, 0, 0);
    lines.forEach((line: string, idx: number) => {
      doc.text(line, 29, startProductY + (idx * productLineHeight), { align: 'center' });
    });

    // Renderiza o Nome da Loja (embaixo, centralizado, preto puro em negrito para não ficar apagado/cinza na térmica)
    if (companyName) {
      const companyY = startProductY + ((lines.length - 1) * productLineHeight) + companyGap;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      const companyLines = doc.splitTextToSize(companyName, maxSafeWidth);
      companyLines.forEach((cLine: string, cIdx: number) => {
        doc.text(cLine, 29, companyY + (cIdx * 3.2), { align: 'center' });
      });
    }

    y = boxTop + itemHeight;

    // Linha de corte pontilhada separando este vale do próximo (de 8mm a 50mm, 100% dentro da cabeça de impressão)
    doc.setLineDashPattern([1.5, 1], 0);
    doc.setLineWidth(0.25);
    doc.line(8, y, 50, y);
  });

  doc.autoPrint();
  const pdfBlob = doc.output('blob');
  const pdfUrl = URL.createObjectURL(pdfBlob);

  return { pdfBlob, pdfUrl };
}

export function printThermalDirectly(pdfUrl: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = pdfUrl;
  document.body.appendChild(iframe);

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.warn('Falha no iframe.print(), fallback para janela:', e);
        const win = window.open(pdfUrl, '_blank');
        win?.focus();
      }
      setTimeout(() => {
        try {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        } catch {}
      }, 60000);
    }, 250);
  };
}
