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

const HARPY_LOGO_BASE64 = "data:image/png;base64,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";

export async function generateThermalReceiptPDF(options: EventReceiptOptions): Promise<{ pdfBlob: Blob; pdfUrl: string }> {
  const { cadetNumber, cadetName, expenses } = options;

  // Cada despesa é 1 vale individual de produto
  const itemHeight = 26; // mm de altura para cada vale de produto

  // Cálculo dinâmico da altura total da bobina
  let calcY = 4;
  const hasHeader = Boolean(cadetNumber || cadetName);
  if (hasHeader) {
    calcY += 21; // Harpia à esquerda + lema em itálico + Cadete + Data/Hora + linha divisória
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
    // Símbolo da turma (Harpia) à esquerda com o lema da turma em itálico ao lado
    try {
      doc.addImage(HARPY_LOGO_BASE64, 'PNG', 11, y, 7.5, 7.5);
    } catch (e) {
      // prossegue normalmente se imagem não renderizar
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 0, 0);
    doc.text('NA UIRAÇU É ASSIM !', 34.5, y + 5.0, { align: 'center' });

    // Avança y com folga segura para que o nome do cadete nunca sobreponha o símbolo
    y += 11.5;

    // Linha do Cadete
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    const cadetInfo = [cadetNumber, shortCadetName].filter(Boolean).join(' ');
    doc.text(`Cad: ${cadetInfo}`, 29, y, { align: 'center' });
    y += 3.6;

    // Linha da Data e Hora
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
