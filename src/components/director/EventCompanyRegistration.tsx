import React, { useState, useEffect } from 'react';
import type { EventCompany, EventProduct } from '../../types';
import { DatabaseService } from '../../lib/pocketbase';
import { PlusCircle, Trash2, Save, Edit3, X, Store, Package, ChevronDown, ChevronRight } from 'lucide-react';

interface EventCompanyRegistrationProps {
  theme?: 'dark' | 'light';
}

export const EventCompanyRegistration: React.FC<EventCompanyRegistrationProps> = ({ theme = 'dark' }) => {
  const isDark = theme === 'dark';

  const [companies, setCompanies] = useState<EventCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Estado do formulário de nova empresa
  const [showForm, setShowForm] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [products, setProducts] = useState<EventProduct[]>([{ name: '', price: 0, category: '' }]);
  const [isSaving, setIsSaving] = useState(false);

  // Configuração global do evento e histórico
  const [globalEventName, setGlobalEventName] = useState('Evento');
  const [eventList, setEventList] = useState<string[]>(['Evento']);
  const [isSavingEventName, setIsSavingEventName] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Expansão
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());

  const loadCompanies = async () => {
    setIsLoading(true);
    try {
      const [data, name, list] = await Promise.all([
        DatabaseService.getEventCompanies(),
        DatabaseService.getSystemSetting('current_event_name', 'Evento').catch(() => 'Evento'),
        DatabaseService.getEventList().catch(() => ['Evento']),
      ]);
      setCompanies(data);
      setGlobalEventName(name);
      setEventList(list);
    } catch (err) {
      console.error('Erro ao carregar empresas:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const handleSaveEventName = async (customName?: string) => {
    const targetName = (customName || globalEventName).trim();
    if (!targetName) {
      alert('Informe o nome do evento.');
      return;
    }
    setIsSavingEventName(true);
    try {
      const ok = await DatabaseService.saveEventName(targetName);
      if (ok) {
        setGlobalEventName(targetName);
        const updatedList = await DatabaseService.getEventList();
        setEventList(updatedList);
        setStatusMessage({
          text: `Evento "${targetName}" ativado com sucesso! Novos lançamentos serão vinculados a este evento.`,
          type: 'success',
        });
        setTimeout(() => setStatusMessage(null), 5000);
      } else {
        setStatusMessage({ text: 'Erro ao salvar o nome do evento no servidor.', type: 'error' });
      }
    } catch (err: any) {
      setStatusMessage({ text: 'Falha na comunicação com o banco: ' + err.message, type: 'error' });
    } finally {
      setIsSavingEventName(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    setCompanyName('');
    setProducts([{ name: '', price: 0, category: '' }]);
    setEditingCompanyId(null);
    setShowForm(false);
  };

  const handleAddProductRow = () => {
    setProducts([...products, { name: '', price: 0, category: '' }]);
  };

  const handleRemoveProductRow = (index: number) => {
    if (products.length <= 1) return;
    setProducts(products.filter((_, i) => i !== index));
  };

  const handleProductChange = (index: number, field: keyof EventProduct, value: string | number) => {
    const updated = [...products];
    if (field === 'price') {
      updated[index] = { ...updated[index], [field]: typeof value === 'string' ? parseFloat(value.replace(',', '.')) || 0 : value };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setProducts(updated);
  };

  const handleSave = async () => {
    if (!companyName.trim()) {
      alert('Informe o nome da empresa.');
      return;
    }

    const validProducts = products.filter((p) => p.name.trim() && p.price > 0);
    if (validProducts.length === 0) {
      alert('Cadastre ao menos um produto com nome e preço válidos.');
      return;
    }

    setIsSaving(true);
    try {
      if (editingCompanyId) {
        await DatabaseService.updateEventCompany(editingCompanyId, {
          name: companyName.trim(),
          products: validProducts,
        });
      } else {
        await DatabaseService.createEventCompany({
          name: companyName.trim(),
          products: validProducts,
        });
      }
      resetForm();
      await loadCompanies();
    } catch (err) {
      console.error('Erro ao salvar empresa:', err);
      alert('Erro ao salvar. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (company: EventCompany) => {
    setCompanyName(company.name);
    setProducts(company.products.length > 0 ? [...company.products] : [{ name: '', price: 0, category: '' }]);
    setEditingCompanyId(company.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta empresa e todos os seus produtos?')) return;
    await DatabaseService.deleteEventCompany(id);
    await loadCompanies();
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* CONFIGURAÇÃO E TRANSIÇÃO ENTRE EVENTOS */}
      <div className={`p-5 rounded-xl border space-y-4 transition-colors ${
        isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              Configuração e Gestão do Evento Ativo
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Este nome aparecerá no extrato e na notinha do cadete: <span className="font-mono font-bold text-orange-400">Produto - Empresa ({globalEventName})</span>
            </p>
          </div>
          <div className={`inline-flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-bold ${
            isDark ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30' : 'bg-orange-50 text-orange-700 border border-orange-200'
          }`}>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Ativo: {globalEventName}</span>
          </div>
        </div>

        {statusMessage && (
          <div className={`p-3 rounded-lg text-xs font-bold flex items-center space-x-2 transition-all ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}>
            <span>{statusMessage.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{statusMessage.text}</span>
          </div>
        )}

        <div className="flex items-center space-x-3">
          <input
            type="text"
            value={globalEventName}
            onChange={(e) => setGlobalEventName(e.target.value)}
            className={`flex-1 border rounded-lg px-4 py-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500/50 ${
              isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
            }`}
            placeholder="Ex: Cardápio SCAER, Baile do Espadim 2026..."
          />
          <button
            onClick={() => handleSaveEventName()}
            disabled={isSavingEventName}
            className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all shadow-md ${
              isDark
                ? 'bg-orange-500 text-slate-950 hover:bg-orange-400 shadow-orange-500/20'
                : 'bg-orange-500 text-white hover:bg-orange-600'
            }`}
          >
            {isSavingEventName ? 'Salvando...' : 'Salvar / Ativar Evento'}
          </button>
        </div>

        {/* Histórico / Transição Rápida entre Eventos */}
        {eventList.length > 0 && (
          <div className="pt-2 border-t border-slate-800/60">
            <div className={`text-[11px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Eventos Cadastrados (clique para alternar o evento ativo):
            </div>
            <div className="flex flex-wrap gap-2">
              {eventList.map((evName) => {
                const isActive = evName.trim() === globalEventName.trim();
                return (
                  <button
                    key={evName}
                    type="button"
                    onClick={() => handleSaveEventName(evName)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 border ${
                      isActive
                        ? isDark
                          ? 'bg-orange-500 text-slate-950 font-bold border-orange-400 shadow-sm'
                          : 'bg-orange-500 text-white font-bold border-orange-600 shadow-sm'
                        : isDark
                          ? 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
                          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    <span>{isActive ? '🎯' : '📅'}</span>
                    <span>{evName}</span>
                    {isActive && <span className="text-[10px] opacity-80">(Ativo)</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* HEADER DA LISTA DE EMPRESAS */}
      <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
        isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg border ${
            isDark ? 'bg-slate-950 border-slate-800 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-600'
          }`}>
            <Store className="w-5 h-5" />
          </div>
          <div>
            <h3 className={`text-sm font-bold uppercase tracking-wider ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              Cadastro de Empresas e Produtos do Evento
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {companies.length} empresa(s) cadastrada(s) · {companies.reduce((a, c) => a + c.products.length, 0)} produto(s) no total
            </p>
          </div>
        </div>

        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center space-x-2 ${
            isDark
              ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-md shadow-amber-500/20'
              : 'bg-amber-500 text-white hover:bg-amber-600 shadow-md'
          }`}
        >
          <PlusCircle className="w-4 h-4" />
          <span>Cadastrar Empresa</span>
        </button>
      </div>

      {/* Formulário de Cadastro / Edição */}
      {showForm && (
        <div className={`p-5 rounded-xl border space-y-4 transition-colors ${
          isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <div className="flex items-center justify-between">
            <h4 className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {editingCompanyId ? '✏️ Editando Empresa' : '➕ Nova Empresa'}
            </h4>
            <button onClick={resetForm} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Nome da empresa */}
          <div className="space-y-1.5">
            <label className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Nome da Empresa</label>
            <input
              type="text"
              placeholder="Ex: Lanchonete do Zé, Bar do Clube..."
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className={`w-full border rounded-xl px-4 py-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900'
              }`}
            />
          </div>

          {/* Lista de Produtos */}
          <div className="space-y-2">
            <label className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Produtos</label>
            {products.map((product, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Nome do produto"
                  value={product.name}
                  onChange={(e) => handleProductChange(idx, 'name', e.target.value)}
                  className={`flex-1 border rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
                <input
                  type="text"
                  placeholder="R$ 0,00"
                  value={product.price || ''}
                  onChange={(e) => handleProductChange(idx, 'price', e.target.value)}
                  className={`w-24 border rounded-xl px-3 py-2 text-xs font-bold font-mono text-center focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                    isDark ? 'bg-slate-950 border-slate-800 text-amber-400' : 'bg-slate-50 border-slate-300 text-amber-700'
                  }`}
                />
                <input
                  type="text"
                  placeholder="Categoria"
                  value={product.category}
                  onChange={(e) => handleProductChange(idx, 'category', e.target.value)}
                  className={`w-28 border rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveProductRow(idx)}
                  disabled={products.length <= 1}
                  className={`p-1.5 rounded-lg transition-colors ${
                    products.length <= 1
                      ? 'opacity-30 cursor-not-allowed'
                      : isDark ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-500'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={handleAddProductRow}
              className={`text-xs font-bold flex items-center space-x-1 px-3 py-1.5 rounded-lg transition-colors ${
                isDark ? 'text-amber-400 hover:bg-amber-500/10' : 'text-amber-600 hover:bg-amber-50'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Adicionar Produto</span>
            </button>
          </div>

          {/* Botão Salvar */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-extrabold text-xs shadow-lg transition-all flex items-center justify-center space-x-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Salvando...' : editingCompanyId ? 'Atualizar Empresa' : 'Cadastrar Empresa'}</span>
          </button>
        </div>
      )}

      {/* Lista de Empresas Cadastradas */}
      {isLoading ? (
        <div className={`text-center py-8 text-xs font-medium ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
          Carregando empresas...
        </div>
      ) : companies.length === 0 ? (
        <div className={`text-center py-12 rounded-xl border ${
          isDark ? 'bg-slate-900/50 border-slate-800 text-slate-500' : 'bg-slate-50 border-slate-200 text-slate-400'
        }`}>
          <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold">Nenhuma empresa cadastrada</p>
          <p className="text-xs mt-1">Clique em "Cadastrar Empresa" para começar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {companies.map((company) => (
            <div
              key={company.id}
              className={`rounded-xl border overflow-hidden transition-colors ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
              }`}
            >
              {/* Cabeçalho da Empresa */}
              <div
                className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                  isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                }`}
                onClick={() => toggleExpand(company.id)}
              >
                <div className="flex items-center space-x-3">
                  {expandedCompanies.has(company.id) ? (
                    <ChevronDown className={`w-4 h-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                  ) : (
                    <ChevronRight className={`w-4 h-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                  )}
                  <Store className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
                  <span className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{company.name}</span>
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                    isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {company.products.length} produto(s)
                  </span>
                </div>

                <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleEdit(company)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isDark ? 'hover:bg-slate-700 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(company.id)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isDark ? 'hover:bg-red-500/20 text-slate-400 hover:text-red-400' : 'hover:bg-red-50 text-slate-500 hover:text-red-500'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Lista de Produtos (expandida) */}
              {expandedCompanies.has(company.id) && (
                <div className={`border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                  {company.products.map((product, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between px-4 py-2.5 text-xs ${
                        idx % 2 === 0
                          ? isDark ? 'bg-slate-950/40' : 'bg-slate-50/50'
                          : ''
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <Package className={`w-3.5 h-3.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                        <span className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{product.name}</span>
                        {product.category && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {product.category}
                          </span>
                        )}
                      </div>
                      <span className={`font-mono font-bold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                        R$ {product.price.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
