import React, { useState, useEffect, useRef } from 'react';
import type { User, Expense, EventCompany, EventProduct } from '../../types';
import { DatabaseService } from '../../lib/pocketbase';
import { ShoppingCart, Trash2, Search, CheckCircle2, X, Store, Package } from 'lucide-react';
import { generateThermalReceiptPDF, printThermalDirectly } from '../../lib/pdfGenerator';

interface LaunchEventExpenseModalProps {
  managerUser: User;
  allCadets: User[];
  onClose: () => void;
  onLaunchBulk: (launches: Omit<Expense, 'id' | 'createdAt' | 'status'>[]) => Promise<void>;
  theme?: 'dark' | 'light';
}

interface SelectedProductItem {
  product: EventProduct;
  quantity: number;
}

interface CompanyEntry {
  companyId: string;
  companyName: string;
  items: SelectedProductItem[];
}

export const LaunchEventExpenseModal: React.FC<LaunchEventExpenseModalProps> = ({
  managerUser,
  allCadets,
  onClose,
  onLaunchBulk,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';

  // Cadete
  const [cadetSearchQuery, setCadetSearchQuery] = useState('');
  const [selectedCadetId, setSelectedCadetId] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  // Empresas do evento
  const [eventCompanies, setEventCompanies] = useState<EventCompany[]>([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);

  // Entradas dinâmicas de empresas + produtos
  const [companyEntries, setCompanyEntries] = useState<CompanyEntry[]>([
    { companyId: '', companyName: '', items: [] },
  ]);

  // Helper para calcular o próximo mês
  const getNextMonth = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // Período
  const [billingPeriod, setBillingPeriod] = useState(getNextMonth());

  // Submit
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [globalEventName, setGlobalEventName] = useState('Evento');

  // Carregar empresas
  useEffect(() => {
    const load = async () => {
      setIsLoadingCompanies(true);
      const data = await DatabaseService.getEventCompanies();
      setEventCompanies(data);
      const name = await DatabaseService.getSystemSetting('current_event_name', 'Evento');
      setGlobalEventName(name);
      setIsLoadingCompanies(false);
    };
    load();
  }, []);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setIsSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtro de cadetes
  const filteredCadets = (() => {
    if (!cadetSearchQuery.trim()) return allCadets;
    const q = cadetSearchQuery.toLowerCase().trim();
    return allCadets.filter(
      (c) =>
        (c.warName || '').toLowerCase().includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.cadetNumber || '').toLowerCase().includes(q)
    );
  })();

  // Handlers de empresa
  const handleSelectCompany = (entryIndex: number, companyId: string) => {
    const company = eventCompanies.find((c) => c.id === companyId);
    if (!company) return;

    const updated = [...companyEntries];
    updated[entryIndex] = {
      companyId: company.id,
      companyName: company.name,
      items: [],
    };

    // Adicionar entrada vazia no final se a última não for vazia
    if (entryIndex === updated.length - 1) {
      updated.push({ companyId: '', companyName: '', items: [] });
    }

    setCompanyEntries(updated);
  };

  const handleRemoveCompanyEntry = (entryIndex: number) => {
    if (companyEntries.length <= 1) return;
    const updated = companyEntries.filter((_, i) => i !== entryIndex);
    setCompanyEntries(updated);
  };

  // Handlers de produto
  const handleToggleProduct = (entryIndex: number, product: EventProduct) => {
    const updated = [...companyEntries];
    const entry = updated[entryIndex];
    const existingIdx = entry.items.findIndex((i) => i.product.name === product.name);

    if (existingIdx >= 0) {
      entry.items = entry.items.filter((_, i) => i !== existingIdx);
    } else {
      entry.items = [...entry.items, { product, quantity: 1 }];
    }

    setCompanyEntries(updated);
  };

  const handleQuantityChange = (entryIndex: number, productName: string, qty: number) => {
    if (qty < 1) return;
    const updated = [...companyEntries];
    const entry = updated[entryIndex];
    const item = entry.items.find((i) => i.product.name === productName);
    if (item) item.quantity = qty;
    setCompanyEntries(updated);
  };

  // Cálculos
  const allSelectedItems = companyEntries.flatMap((entry) =>
    entry.companyId
      ? entry.items.map((item) => ({
          companyName: entry.companyName,
          productName: item.product.name,
          category: item.product.category,
          unitPrice: item.product.price,
          quantity: item.quantity,
          total: item.product.price * item.quantity,
        }))
      : []
  );

  const grandTotal = allSelectedItems.reduce((acc, i) => acc + i.total, 0);
  const totalItems = allSelectedItems.reduce((acc, i) => acc + i.quantity, 0);

  // Submit
  const handleSubmit = async () => {
    if (!selectedCadetId) {
      alert('Selecione o cadete.');
      return;
    }

    if (allSelectedItems.length === 0) {
      alert('Selecione ao menos um produto.');
      return;
    }

    const cadet = allCadets.find((c) => c.id === selectedCadetId);
    if (!cadet) return;

    setIsSubmitting(true);
    try {
      const launches: Omit<Expense, 'id' | 'createdAt' | 'status'>[] = [];

      for (const item of allSelectedItems) {
        for (let q = 0; q < item.quantity; q++) {
          launches.push({
            userId: cadet.id,
            cadetId: cadet.id,
            cadetNumber: cadet.cadetNumber,
            cadetName: cadet.warName || cadet.name,
            userName: cadet.warName || cadet.name,
            clubId: 'EVENTO',
            clubName: item.companyName,
            description: item.quantity > 1
              ? `${item.productName} - ${item.companyName} (${globalEventName}) [${q + 1}/${item.quantity}]`
              : `${item.productName} - ${item.companyName} (${globalEventName})`,
            amount: item.unitPrice,
            category: (item.category || 'Evento') as Expense['category'],
            billingPeriod,
            type: 'individual',
            launchType: 'individual',
            createdBy: managerUser.id,
            createdByName: managerUser.warName || managerUser.name,
          });
        }
      }

      await onLaunchBulk(launches);

      // Gerar notinha térmica automática
      try {
        const { pdfUrl } = await generateThermalReceiptPDF({
          cadetNumber: cadet.cadetNumber || '',
          cadetName: cadet.warName || cadet.name,
          period: billingPeriod,
          expenses: launches as Expense[],
          director: managerUser,
        });
        printThermalDirectly(pdfUrl);
      } catch (pdfErr) {
        console.error('Erro ao gerar recibo térmico automático:', pdfErr);
      }

      // Lançamento concluído e impressão disparada diretamente para a máquina
      onClose();
    } catch (err) {
      console.error('Erro ao lançar gastos de evento:', err);
      alert('Erro ao registrar lançamentos de evento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className={`w-full max-w-2xl rounded-3xl border p-6 sm:p-8 shadow-2xl space-y-5 my-8 transition-colors ${
        isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}>

        {/* Header */}
        <div className={`flex items-center justify-between border-b pb-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-orange-500/10 text-orange-400 border border-orange-500/20">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold">Lançar Gasto EVENTO</h3>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Selecione cadete, empresa(s) e produto(s)</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg ${isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}>
            ✕
          </button>
        </div>

        {/* 1. Selecionar Cadete */}
        <div className="space-y-1.5">
          <label className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Selecionar Cadete</label>
          <div className="relative">
            <div className={`flex items-center w-full border rounded-2xl overflow-hidden transition-all ${
              isSearchDropdownOpen ? 'ring-2 ring-amber-500/50' : ''
            } ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-300'}`}>
              <Search className={`w-4 h-4 ml-4 shrink-0 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Buscar por nome, nome de guerra ou número..."
                value={cadetSearchQuery}
                onChange={(e) => { setCadetSearchQuery(e.target.value); setIsSearchDropdownOpen(true); }}
                onFocus={() => setIsSearchDropdownOpen(true)}
                className={`w-full px-3 py-3 text-xs font-semibold focus:outline-none bg-transparent ${
                  isDark ? 'text-slate-100 placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'
                }`}
              />
              {cadetSearchQuery && (
                <button type="button" onClick={() => { setCadetSearchQuery(''); setSelectedCadetId(''); setIsSearchDropdownOpen(true); searchInputRef.current?.focus(); }}
                  className={`mr-2 p-1 rounded-lg ${isDark ? 'hover:bg-slate-800 text-slate-500' : 'hover:bg-slate-200 text-slate-400'}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {isSearchDropdownOpen && (
              <div ref={searchDropdownRef} className={`absolute z-50 w-full mt-1 max-h-48 overflow-y-auto border rounded-2xl shadow-xl ${
                isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
              }`}>
                {filteredCadets.length === 0 ? (
                  <div className={`px-4 py-3 text-xs font-medium ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    Nenhum cadete encontrado
                  </div>
                ) : filteredCadets.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setSelectedCadetId(c.id); setCadetSearchQuery(`${c.cadetNumber} ${c.warName}`); setIsSearchDropdownOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-xs font-semibold transition-colors flex items-center space-x-2 ${
                      selectedCadetId === c.id
                        ? isDark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-50 text-amber-700'
                        : isDark ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-slate-50 text-slate-800'
                    }`}>
                    <span className="font-mono text-amber-400 font-bold shrink-0">{c.cadetNumber}</span>
                    <span className="font-bold">{c.warName}</span>
                    <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>({c.name})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedCadetId && !isSearchDropdownOpen && (() => {
            const sel = allCadets.find(c => c.id === selectedCadetId);
            return sel ? (
              <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl text-[11px] font-bold ${
                isDark ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Selecionado: {sel.cadetNumber} {sel.warName}</span>
              </div>
            ) : null;
          })()}
        </div>

        {/* 2. Empresas e Produtos */}
        {isLoadingCompanies ? (
          <div className={`text-center py-4 text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Carregando empresas do evento...</div>
        ) : eventCompanies.length === 0 ? (
          <div className={`text-center py-6 rounded-xl border ${isDark ? 'bg-slate-950 border-slate-800 text-slate-500' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
            <Store className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs font-bold">Nenhuma empresa cadastrada</p>
            <p className="text-[11px] mt-1">Cadastre empresas na aba "Cadastro Eventos" primeiro.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <label className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Empresas e Produtos</label>

            {companyEntries.map((entry, entryIdx) => (
              <div key={entryIdx} className={`rounded-2xl border p-4 space-y-3 transition-colors ${
                entry.companyId
                  ? isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'
                  : isDark ? 'bg-slate-950/50 border-slate-800 border-dashed' : 'bg-slate-50/50 border-slate-200 border-dashed'
              }`}>
                {/* Seletor de empresa */}
                <div className="flex items-center gap-2">
                  <Store className={`w-4 h-4 shrink-0 ${isDark ? 'text-orange-400' : 'text-orange-600'}`} />
                  <select
                    value={entry.companyId}
                    onChange={(e) => handleSelectCompany(entryIdx, e.target.value)}
                    className={`flex-1 border rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500/50 ${
                      isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  >
                    <option value="">Selecionar empresa...</option>
                    {eventCompanies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {companyEntries.length > 1 && (
                    <button type="button" onClick={() => handleRemoveCompanyEntry(entryIdx)}
                      className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-red-500/20 text-slate-500 hover:text-red-400' : 'hover:bg-red-50 text-slate-400 hover:text-red-500'}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Lista de produtos da empresa selecionada */}
                {entry.companyId && (() => {
                  const company = eventCompanies.find((c) => c.id === entry.companyId);
                  if (!company) return null;
                  return (
                    <div className="space-y-1.5 pl-6">
                      {company.products.map((product) => {
                        const isSelected = entry.items.some((i) => i.product.name === product.name);
                        const selectedItem = entry.items.find((i) => i.product.name === product.name);
                        return (
                          <div key={product.name} className={`flex items-center justify-between py-2 px-3 rounded-xl text-xs transition-colors ${
                            isSelected
                              ? isDark ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-orange-50 border border-orange-200'
                              : isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-100'
                          }`}>
                            <label className="flex items-center space-x-2.5 cursor-pointer flex-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleProduct(entryIdx, product)}
                                className="rounded border-slate-600 text-orange-500 focus:ring-orange-500"
                              />
                              <Package className={`w-3.5 h-3.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                              <span className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{product.name}</span>
                              {product.category && (
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-500'
                                }`}>{product.category}</span>
                              )}
                            </label>

                            <div className="flex items-center space-x-2">
                              {isSelected && selectedItem && (
                                <div className="flex items-center space-x-1">
                                  <label className={`text-[10px] font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Qtd:</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={selectedItem.quantity}
                                    onChange={(e) => handleQuantityChange(entryIdx, product.name, parseInt(e.target.value) || 1)}
                                    className={`w-12 border rounded-lg px-1.5 py-1 text-xs font-bold text-center focus:outline-none focus:ring-1 focus:ring-orange-500/50 ${
                                      isDark ? 'bg-slate-900 border-slate-700 text-orange-400' : 'bg-white border-slate-300 text-orange-700'
                                    }`}
                                  />
                                </div>
                              )}
                              <span className={`font-mono font-bold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                                R$ {isSelected && selectedItem
                                  ? (product.price * selectedItem.quantity).toFixed(2)
                                  : product.price.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {/* Resumo */}
        {allSelectedItems.length > 0 && (
          <div className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between ${
            isDark ? 'bg-orange-500/10 border-orange-500/20 text-orange-300' : 'bg-orange-50 border-orange-200 text-orange-700'
          }`}>
            <div className="flex items-center space-x-2">
              <ShoppingCart className="w-4 h-4" />
              <span>{totalItems} item(ns) de {companyEntries.filter(e => e.companyId && e.items.length > 0).length} empresa(s)</span>
            </div>
            <span className="text-sm font-extrabold font-mono">R$ {grandTotal.toFixed(2)}</span>
          </div>
        )}

        {/* Período e Confirmar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div className="space-y-1.5">
            <label className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Mês de Cobrança</label>
            <select
              value={billingPeriod}
              onChange={(e) => setBillingPeriod(e.target.value)}
              className={`w-full border rounded-2xl px-4 py-2.5 text-xs font-semibold focus:outline-none ${
                isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            >
              {Array.from({ length: 6 }).map((_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() + 2 - i); // Próximos 2 meses até 3 meses atrás
                const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const monthName = d.toLocaleString('pt-BR', { month: 'long' });
                const label = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} / ${d.getFullYear()}`;
                const isFuture = d > new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                return (
                  <option key={val} value={val}>
                    {label} {isFuture ? '(Prévia)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || allSelectedItems.length === 0 || !selectedCadetId}
              className={`w-full py-3 rounded-2xl font-extrabold text-xs shadow-lg transition-all flex items-center justify-center space-x-2 ${
                allSelectedItems.length === 0 || !selectedCadetId
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-400 hover:to-red-500 text-white'
              }`}
            >
              <span>{isSubmitting ? 'Gravando...' : `Confirmar ${totalItems} Lançamento(s)`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
