import PocketBase from 'pocketbase';
import type {
  User,
  Club,
  ClubMembership,
  Transaction,
  DirectorReport,
  MonthlySummary,
  ScaerConfig,
  Cadet,
  InstallmentInfo,
  TransactionType,
  TransactionStatus,
  CadetRosterItem,
  PendingExemption,
  DesligadoItem,
  EventCompany,
} from '../types';
import { queryCache } from './queryCache';

export const POCKETBASE_URL = import.meta.env.POCKETBASE_URL || 'https://cedula-scaer.pockethost.io';
export const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

export const getPeriodStr = (date: Date): string => {
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
};

export const getNextPeriod = (currentPeriod: string): string => {
  const [year, month] = currentPeriod.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return getPeriodStr(d);
};

export const addMonths = (period: string, monthsToAdd: number): string => {
  const [year, month] = period.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  d.setMonth(d.getMonth() + monthsToAdd);
  return getPeriodStr(d);
};

class DatabaseServiceClass {
  // Connection & Auth
  async checkConnection(): Promise<boolean> {
    try {
      const health = await pb.health.check();
      return health.code === 200;
    } catch (error) {
      console.error('Falha na conexão com o PocketBase:', error);
      return false;
    }
  }

  async getUsers(): Promise<User[]> {
    return queryCache.fetch('users', async () => {
      try {
        const records = await pb.collection('users').getFullList({ sort: 'warName' });
        return records as unknown as User[];
      } catch (error) {
        console.error('Erro ao buscar usuários:', error);
        return [];
      }
    });
  }

  getCurrentUser(): User | null {
    return (pb.authStore.record as unknown as User) || null;
  }

  // Cadets
  async getCadets(): Promise<Cadet[]> {
    return queryCache.fetch('cadets', async () => {
      try {
        const records = await pb.collection('cadets').getFullList({ sort: 'cadetNumber' });
        return records as unknown as Cadet[];
      } catch (error) {
        console.error('Erro ao buscar cadetes:', error);
        return [];
      }
    });
  }

  async getCadetByUserId(userId: string): Promise<Cadet | null> {
    try {
      const record = await pb.collection('cadets').getFirstListItem(`userId="${userId}"`);
      return record as unknown as Cadet;
    } catch {
      return null;
    }
  }

  async updateCadetClubs(cadetId: string, clubs: string[]): Promise<Cadet | null> {
    try {
      const record = await pb.collection('cadets').update(cadetId, { clubs });
      queryCache.clear('cadets');
      return record as unknown as Cadet;
    } catch (error) {
      console.error('Erro ao atualizar clubes do cadete:', error);
      return null;
    }
  }

  // Clubs
  async getClubs(): Promise<Club[]> {
    return queryCache.fetch('clubs', async () => {
      try {
        const records = await pb.collection('clubs').getFullList({ sort: 'name' });
        return records as unknown as Club[];
      } catch (error) {
        console.error('Erro ao buscar clubes:', error);
        return [];
      }
    });
  }

  async updateClub(clubId: string, data: Partial<Club>): Promise<Club | null> {
    try {
      const record = await pb.collection('clubs').update(clubId, data);
      queryCache.clear('clubs');
      return record as unknown as Club;
    } catch (error) {
      console.error('Erro ao atualizar clube:', error);
      return null;
    }
  }

  // Memberships
  async getMemberships(): Promise<ClubMembership[]> {
    return queryCache.fetch('club_memberships', async () => {
      try {
        const records = await pb.collection('club_memberships').getFullList({ sort: '-created' });
        return records as unknown as ClubMembership[];
      } catch (error) {
        console.error('Erro ao buscar associações:', error);
        return [];
      }
    });
  }

  async syncCadetPreviewOnClubChange(
    user: User,
    club: Club,
    action: 'join' | 'leave',
    effectivePeriod: string
  ): Promise<void> {
    try {
      const filter = `(userId="${user.id}" || cadetId="${user.id}" || cadetNumber="${user.cadetNumber}") && clubId="${club.id}" && billingPeriod="${effectivePeriod}" && status="preview"`;
      const txs = await pb.collection('transactions').getFullList({ filter });

      if (action === 'leave') {
        for (const tx of txs) {
          await pb.collection('transactions').delete(tx.id).catch(() => null);
        }
      } else if (action === 'join') {
        if (txs.length === 0 && club.monthlyFee && club.monthlyFee > 0) {
          await pb.collection('transactions').create({
            userId: user.id,
            cadetId: user.id,
            cadetNumber: user.cadetNumber || '',
            cadetName: user.warName || user.name || '',
            userName: user.warName || user.name || '',
            clubId: club.id,
            clubName: club.name,
            description: `Mensalidade ${club.name} (Prévia)`,
            amount: club.monthlyFee,
            category: 'mensalidade_clube',
            billingPeriod: effectivePeriod,
            type: 'automatic',
            status: 'preview',
            createdBy: 'system',
            createdByName: 'Sistema (Prévia)',
          }).catch(() => null);
        }
      }
      queryCache.clear();
    } catch (err) {
      console.error('Erro ao sincronizar prévia de clube:', err);
    }
  }

  async requestClubMembership(
    userId: string,
    clubId: string,
    action: 'join' | 'leave',
    notes?: string
  ): Promise<ClubMembership | null> {
    try {
      const today = new Date();
      const config = await this.getScaerConfig();
      const currentPeriod = config?.currentBillingPeriod || getPeriodStr(today);
      const isBeforeDeadline = today.getDate() <= (config?.clubChangeDeadlineDay || 20);

      // Regra do dia 20: até dia 20 vigora para o mês seguinte (M+1); após dia 20 vigora para M+2
      const effectiveFrom = isBeforeDeadline
        ? getNextPeriod(currentPeriod)
        : getNextPeriod(getNextPeriod(currentPeriod));

      const status = action === 'join' ? 'pending_entry' : 'pending_exit';

      // Buscar info do usuário e clube para salvar desnormalizado
      const users = await this.getUsers();
      const clubs = await this.getClubs();
      const user = users.find((u) => u.id === userId);
      const club = clubs.find((c) => c.id === clubId);

      const existingMemberships = await this.getMemberships();
      const existing = existingMemberships.find((m) => m.userId === userId && m.clubId === clubId);

      let record;
      if (existing) {
        record = await pb.collection('club_memberships').update(existing.id, {
          status,
          requestedAt: new Date().toISOString(),
          notes: notes || existing.notes,
          effectiveFrom,
        });
      } else {
        const data = {
          userId,
          userName: user?.warName || user?.name || '',
          cadetNumber: user?.cadetNumber || '',
          squadron: user?.squadron || '',
          clubId,
          clubName: club?.name || '',
          status,
          requestedAt: new Date().toISOString(),
          notes,
          effectiveFrom,
        };
        record = await pb.collection('club_memberships').create(data);
      }

      // Sincronizar imediatamente a prévia do próximo mês se for antes do dia 20
      if (isBeforeDeadline && user && club) {
        await this.syncCadetPreviewOnClubChange(user, club, action, effectiveFrom);
      }

      queryCache.clear('club_memberships');
      queryCache.clear('transactions');
      return record as unknown as ClubMembership;
    } catch (error) {
      console.error('Erro ao solicitar associação:', error);
      return null;
    }
  }

  async updateMembershipStatus(
    membershipId: string,
    status: 'approved' | 'rejected' | 'inactive' | 'active'
  ): Promise<ClubMembership | null> {
    try {
      const now = new Date().toISOString().split('T')[0];
      const data = {
        status,
        approvedAt: status === 'approved' || status === 'active' ? now : null,
      };
      const record = await pb.collection('club_memberships').update(membershipId, data);
      queryCache.clear('club_memberships');
      return record as unknown as ClubMembership;
    } catch (error) {
      console.error('Erro ao atualizar status da associação:', error);
      return null;
    }
  }

  // Transactions
  async getTransactions(period?: string): Promise<Transaction[]> {
    if (period) {
      return this.getTransactionsByPeriod(period);
    }
    return queryCache.fetch('transactions_current', async () => {
      try {
        const records = await pb.collection('transactions').getList(1, 500, { sort: '-created' });
        return records.items as unknown as Transaction[];
      } catch (err) {
        console.error('Erro ao buscar transações:', err);
        return [];
      }
    });
  }

  // Alias para compatibilidade com componentes existentes
  async getExpenses(): Promise<Transaction[]> {
    return this.getTransactions();
  }

  async getTransactionsForCadet(user: User): Promise<Transaction[]> {
    const num = user.cadetNumber || '';
    const cleanNum = num.replace(/\D/g, '');
    const formattedNum = cleanNum.length === 5 ? `${cleanNum.slice(0, 2)}/${cleanNum.slice(2)}` : num;

    const filterParts: string[] = [];
    if (user.id) {
      filterParts.push(`userId="${user.id}"`);
      filterParts.push(`cadetId="${user.id}"`);
    }
    if (num) filterParts.push(`cadetNumber="${num}"`);
    if (cleanNum) filterParts.push(`cadetNumber="${cleanNum}"`);
    if (formattedNum) filterParts.push(`cadetNumber="${formattedNum}"`);

    const filter = filterParts.join(' || ');
    return queryCache.fetch(`transactions_cadet_${user.id}`, async () => {
      try {
        const records = await pb.collection('transactions').getFullList({
          filter,
          sort: '-billingPeriod',
        });
        return records as unknown as Transaction[];
      } catch (err) {
        console.error('Erro ao buscar transações do cadete:', err);
        return [];
      }
    });
  }

  async getTransactionsByPeriod(period: string): Promise<Transaction[]> {
    return queryCache.fetch(`transactions_${period}`, async () => {
      try {
        const records = await pb.collection('transactions').getFullList({
          batch: 500,
          filter: `billingPeriod="${period}"`,
        });
        return records as unknown as Transaction[];
      } catch (err) {
        console.error(`Erro ao buscar transações do período ${period}:`, err);
        return [];
      }
    });
  }

  async getTransactionsByCadet(cadetId: string, period?: string): Promise<Transaction[]> {
    try {
      let filter = `(cadetId="${cadetId}" || userId="${cadetId}")`;
      if (period) {
        filter += ` && billingPeriod="${period}"`;
      }
      const records = await pb.collection('transactions').getFullList({
        filter,
        sort: '-created',
      });
      return records as unknown as Transaction[];
    } catch {
      const all = await this.getTransactions();
      return all.filter(
        (t) => (t.cadetId === cadetId || t.userId === cadetId) && (!period || t.billingPeriod === period)
      );
    }
  }

  async createTransaction(data: Partial<Transaction>): Promise<Transaction | null> {
    try {
      const record = await pb.collection('transactions').create(data);
      queryCache.clear('transactions');
      if (data.billingPeriod) queryCache.clear(`transactions_${data.billingPeriod}`);
      return record as unknown as Transaction;
    } catch (error) {
      console.error('Erro ao criar transação:', error);
      return null;
    }
  }

  async createTransactions(dataList: Partial<Transaction>[]): Promise<Transaction[]> {
    const results: Transaction[] = [];
    try {
      for (const data of dataList) {
        const record = await pb.collection('transactions').create(data);
        results.push(record as unknown as Transaction);
      }
      queryCache.clear(); // Clear all caches to ensure transactions_${period} is invalidated
      return results;
    } catch (error) {
      console.error('Erro ao criar múltiplas transações:', error);
      return results;
    }
  }

  // Alias para compatibilidade
  async createExpenses(dataList: Partial<Transaction>[]): Promise<Transaction[]> {
    return this.createTransactions(dataList);
  }

  async updateTransaction(id: string, data: Partial<Transaction>): Promise<Transaction | null> {
    try {
      const record = await pb.collection('transactions').update(id, data);
      queryCache.clear('transactions');
      if (data.billingPeriod) queryCache.clear(`transactions_${data.billingPeriod}`);
      return record as unknown as Transaction;
    } catch (error) {
      console.error('Erro ao atualizar transação:', error);
      return null;
    }
  }

  async deleteTransaction(id: string): Promise<boolean> {
    try {
      await pb.collection('transactions').delete(id);
      queryCache.clear('transactions');
      return true;
    } catch (error) {
      console.error('Erro ao excluir transação:', error);
      return false;
    }
  }

  async installTransaction(id: string, numInstallments: number, startPeriod: string): Promise<boolean> {
    try {
      const original = (await pb.collection('transactions').getOne(id)) as unknown as Transaction;
      await pb.collection('transactions').update(id, { status: 'cancelled', notes: `Parcelado em ${numInstallments}x` });

      const amountPerInst = Math.floor((original.amount / numInstallments) * 100) / 100;
      const remainder = original.amount - amountPerInst * numInstallments;

      const newTxs: Partial<Transaction>[] = [];
      for (let i = 0; i < numInstallments; i++) {
        const currentAmount = i === 0 ? amountPerInst + remainder : amountPerInst;
        const currentPeriod = addMonths(startPeriod, i);

        const installmentInfo: InstallmentInfo = {
          current: i + 1,
          total: numInstallments,
          originalTransactionId: id,
        };

        const txData: Partial<Transaction> = {
          ...original,
          id: undefined,
          amount: currentAmount,
          description: `${original.description} (${i + 1}/${numInstallments})`,
          billingPeriod: currentPeriod,
          originalAmount: original.amount,
          type: 'installment' as TransactionType,
          status: 'pending' as TransactionStatus,
          installmentInfo,
        };
        newTxs.push(txData);
      }

      await this.createTransactions(newTxs);
      return true;
    } catch (error) {
      console.error('Erro ao parcelar transação:', error);
      return false;
    }
  }

  async deferTransaction(id: string, targetPeriod: string): Promise<boolean> {
    try {
      const original = (await pb.collection('transactions').getOne(id)) as unknown as Transaction;
      await pb.collection('transactions').update(id, {
        status: 'deferred',
        deferredTo: targetPeriod,
      });

      const txData: Partial<Transaction> = {
        ...original,
        id: undefined,
        billingPeriod: targetPeriod,
        originalPeriod: original.billingPeriod,
        type: 'deferred' as TransactionType,
        status: 'pending' as TransactionStatus,
        notes: `Adiado do período ${original.billingPeriod}`,
      };

      await this.createTransaction(txData);
      return true;
    } catch (error) {
      console.error('Erro ao adiar transação:', error);
      return false;
    }
  }

  async deferAllCadetTransactions(cadetId: string, sourcePeriod: string, targetPeriod: string): Promise<boolean> {
    try {
      const txs = await this.getTransactionsByCadet(cadetId, sourcePeriod);
      const pendingTxs = txs.filter((t) => t.status === 'pending' || !t.status);

      for (const tx of pendingTxs) {
        await this.deferTransaction(tx.id, targetPeriod);
      }
      return true;
    } catch (error) {
      console.error('Erro ao adiar todas transações:', error);
      return false;
    }
  }

  async installAllCadetTransactions(
    cadetId: string,
    period: string,
    numInstallments: number
  ): Promise<boolean> {
    try {
      const txs = await this.getTransactionsByCadet(cadetId, period);
      const pendingTxs = txs.filter((t) => t.status === 'pending' || !t.status);

      for (const tx of pendingTxs) {
        await this.installTransaction(tx.id, numInstallments, period);
      }
      return true;
    } catch (error) {
      console.error('Erro ao parcelar todas transações:', error);
      return false;
    }
  }

  // Monthly Summaries
  async getMonthlySummaries(): Promise<MonthlySummary[]> {
    return queryCache.fetch('monthly_summaries', async () => {
      try {
        const records = await pb.collection('monthly_summaries').getFullList({ sort: '-billingPeriod' });
        return records as unknown as MonthlySummary[];
      } catch (error) {
        console.error('Erro ao buscar resumos:', error);
        return [];
      }
    });
  }

  async generateMonthlySummary(period: string): Promise<MonthlySummary | null> {
    try {
      const txs = await this.getTransactionsByPeriod(period);

      let totalGeneral = 0;
      let scaerFeeTotal = 0;
      const clubMap: Record<string, { clubId: string; clubName: string; amount: number; transactionsCount: number }> = {};
      const cadetMap: Record<string, { cadetId: string; cadetNumber: string; cadetName: string; amount: number }> = {};

      for (const tx of txs) {
        if (tx.status !== 'cancelled' && tx.status !== 'deferred') {
          totalGeneral += tx.amount;
          if (tx.category === 'mensalidade_scaer' || tx.description.includes('SCAER')) {
            scaerFeeTotal += tx.amount;
          }

          if (tx.clubId) {
            if (!clubMap[tx.clubId]) {
              clubMap[tx.clubId] = {
                clubId: tx.clubId,
                clubName: tx.clubName || tx.clubId,
                amount: 0,
                transactionsCount: 0,
              };
            }
            clubMap[tx.clubId].amount += tx.amount;
            clubMap[tx.clubId].transactionsCount += 1;
          }

          const cId = tx.cadetId || tx.userId || tx.cadetNumber;
          if (cId) {
            if (!cadetMap[cId]) {
              cadetMap[cId] = {
                cadetId: cId,
                cadetNumber: tx.cadetNumber,
                cadetName: tx.cadetName || tx.userName || '',
                amount: 0,
              };
            }
            cadetMap[cId].amount += tx.amount;
          }
        }
      }

      const clubBreakdown = Object.values(clubMap);
      const cadetBreakdown = Object.values(cadetMap);
      const totalCadets = cadetBreakdown.length;

      const existing = await pb
        .collection('monthly_summaries')
        .getFirstListItem(`billingPeriod="${period}"`)
        .catch(() => null);

      const data = {
        billingPeriod: period,
        totalGeneral,
        totalCadets,
        totalTransactions: txs.length,
        clubBreakdown,
        cadetBreakdown,
        scaerFeeTotal,
        status: 'open' as const,
      };

      let record;
      if (existing) {
        record = await pb.collection('monthly_summaries').update(existing.id, data);
      } else {
        record = await pb.collection('monthly_summaries').create(data);
      }

      queryCache.clear('monthly_summaries');
      return record as unknown as MonthlySummary;
    } catch (error) {
      console.error('Erro ao gerar resumo mensal:', error);
      return null;
    }
  }

  // SCAER Config
  async getScaerConfig(): Promise<ScaerConfig | null> {
    return queryCache.fetch('scaer_config', async () => {
      try {
        const records = await pb.collection('scaer_config').getFullList();
        if (records.length > 0) {
          return records[0] as unknown as ScaerConfig;
        }
        return {
          id: 'default_config',
          scaerMonthlyFee: 100,
          currentBillingPeriod: '2026-08',
          dueDay: 10,
          clubChangeDeadlineDay: 20,
        };
      } catch {
        return {
          id: 'default_config',
          scaerMonthlyFee: 100,
          currentBillingPeriod: '2026-08',
          dueDay: 10,
          clubChangeDeadlineDay: 20,
        };
      }
    });
  }

  async updateScaerConfig(data: Partial<ScaerConfig>): Promise<ScaerConfig | null> {
    try {
      const records = await pb.collection('scaer_config').getFullList().catch(() => []);
      let record;
      if (records.length > 0) {
        record = await pb.collection('scaer_config').update(records[0].id, data);
      } else {
        record = await pb.collection('scaer_config').create({
          scaerMonthlyFee: 100,
          currentBillingPeriod: '2026-08',
          dueDay: 10,
          clubChangeDeadlineDay: 20,
          ...data,
        });
      }
      queryCache.clear('scaer_config');
      return record as unknown as ScaerConfig;
    } catch (error) {
      console.error('Erro ao atualizar config:', error);
      return null;
    }
  }

  // Director Reports
  async getDirectorReports(): Promise<DirectorReport[]> {
    return queryCache.fetch('director_reports', async () => {
      try {
        const records = await pb.collection('director_reports').getFullList<DirectorReport>({ sort: '-created' });
        return records || [];
      } catch (error) {
        console.error('Erro ao buscar relatórios:', error);
        return [];
      }
    });
  }

  async saveDirectorReport(report: Partial<DirectorReport>): Promise<DirectorReport | null> {
    try {
      const record = await pb.collection('director_reports').create<DirectorReport>(report);
      queryCache.clear('director_reports');
      return record;
    } catch (error) {
      console.error('Erro ao salvar relatório:', error);
      return null;
    }
  }

  // Recurring Billing / Manual Launch
  async triggerRecurringMonthlyFees(clubId: string, billingPeriod: string, managerUser: User): Promise<number> {
    const memberships = await this.getMemberships();
    const clubs = await this.getClubs();
    const club = clubs.find((c) => c.id === clubId);

    if (!club) throw new Error('Clube não encontrado');

    const activeMembers = memberships.filter((m) => m.clubId === clubId && (m.status === 'approved' || m.status === 'active'));
    const existingTransactions = await this.getTransactions();
    const newLaunches: Partial<Transaction>[] = [];

    for (const member of activeMembers) {
      const alreadyBilled = existingTransactions.some(
        (e) =>
          (e.userId === member.userId || e.cadetNumber === member.cadetNumber) &&
          e.clubId === clubId &&
          e.billingPeriod === billingPeriod &&
          (e.category === 'Mensalidade' || e.category === 'mensalidade_clube')
      );

      if (!alreadyBilled) {
        newLaunches.push({
          userId: member.userId,
          cadetId: member.userId,
          userName: member.userName,
          cadetName: member.userName,
          cadetNumber: member.cadetNumber,
          clubId: club.id,
          clubName: club.name,
          description: `Mensalidade ${billingPeriod} - ${club.code || club.name}`,
          amount: club.monthlyFee,
          category: 'mensalidade_clube',
          billingPeriod,
          type: 'recurring',
          createdBy: managerUser.id,
          createdByName: managerUser.warName || managerUser.name,
          status: 'pending',
        });
      }
    }

    if (newLaunches.length > 0) {
      await this.createTransactions(newLaunches);
    }

    return newLaunches.length;
  }

  async triggerMonthlyBilling(period: string): Promise<boolean> {
    try {
      const config = await this.getScaerConfig();
      const fee = config?.scaerMonthlyFee || 100;
      const users = await this.getUsers();
      const cadetes = users.filter((u) => u.role === 'cadete' || !u.role);
      const existingTxs = await this.getTransactionsByPeriod(period);

      const txsToCreate: Partial<Transaction>[] = [];

      for (const cadet of cadetes) {
        // Verificar se já tem mensalidade SCAER
        const hasScaer = existingTxs.some(
          (t) =>
            (t.userId === cadet.id || t.cadetNumber === cadet.cadetNumber) &&
            (t.category === 'mensalidade_scaer' || t.description.includes('Mensalidade SCAER'))
        );

        if (!hasScaer) {
          txsToCreate.push({
            userId: cadet.id,
            cadetId: cadet.id,
            cadetNumber: cadet.cadetNumber,
            cadetName: cadet.warName || cadet.name,
            userName: cadet.warName || cadet.name,
            clubId: 'SCAER',
            clubName: 'SCAER',
            description: 'Mensalidade SCAER',
            amount: fee,
            category: 'mensalidade_scaer',
            billingPeriod: period,
            type: 'automatic',
            status: 'pending',
          });
        }
      }

      if (txsToCreate.length > 0) {
        await this.createTransactions(txsToCreate);
      }
      await this.generateMonthlySummary(period);
      return true;
    } catch (error) {
      console.error('Erro no faturamento mensal:', error);
      return false;
    }
  }

  // Sincronização de Doação na Prévia
  async syncCadetPreviewOnDonationChange(
    user: User,
    clubId: string,
    clubName: string,
    amount: number,
    effectivePeriod: string
  ): Promise<void> {
    try {
      const filter = `(userId="${user.id}" || cadetId="${user.id}" || cadetNumber="${user.cadetNumber}") && (clubId="${clubId}" || category="doacao_religiosa") && billingPeriod="${effectivePeriod}" && status="preview"`;
      const existingTxs = await pb.collection('transactions').getFullList({ filter });
      const matched = existingTxs.find(
        (tx) => tx.clubId === clubId || (clubName && tx.description.toLowerCase().includes(clubName.toLowerCase()))
      );

      if (amount <= 0) {
        if (matched) {
          await pb.collection('transactions').delete(matched.id).catch(() => null);
        }
      } else {
        if (matched) {
          await pb.collection('transactions').update(matched.id, {
            amount,
            description: `Doação Mensal - ${clubName || matched.clubName} (Prévia)`,
          });
        } else {
          await pb.collection('transactions').create({
            userId: user.id,
            cadetId: user.id,
            userName: user.warName || user.name,
            cadetName: user.warName || user.name,
            cadetNumber: user.cadetNumber,
            clubId,
            clubName,
            description: `Doação Mensal - ${clubName} (Prévia)`,
            amount,
            category: 'doacao_religiosa',
            billingPeriod: effectivePeriod,
            type: 'recurring',
            createdBy: user.id,
            createdByName: user.warName || user.name,
            status: 'preview',
          });
        }
      }
      queryCache.clear();
    } catch (err) {
      console.error('Erro ao sincronizar doação na prévia:', err);
    }
  }

  // Religious Donations
  async setCadetReligiousDonation(
    userId: string,
    clubId: string,
    clubName: string,
    amount: number,
    billingPeriod?: string
  ): Promise<boolean> {
    try {
      const users = await this.getUsers();
      const user = users.find((u) => u.id === userId);
      if (!user) throw new Error('Usuário não encontrado');

      const today = new Date();
      const config = await this.getScaerConfig();
      const currentPeriod = config?.currentBillingPeriod || getPeriodStr(today);
      const isBeforeDeadline = today.getDate() <= (config?.clubChangeDeadlineDay || 20);

      // Regra do dia 20: até dia 20 afeta a prévia de M+1; após dia 20 afeta M+2
      const targetPeriod = billingPeriod || (isBeforeDeadline
        ? getNextPeriod(currentPeriod)
        : getNextPeriod(getNextPeriod(currentPeriod)));

      const now = new Date().toISOString().split('T')[0];
      const memberships = await this.getMemberships();
      const existingMem = memberships.find(
        (m) =>
          m.userId === userId &&
          (m.clubId === clubId || (m.clubName && m.clubName.toLowerCase() === clubName.toLowerCase()))
      );

      if (existingMem) {
        await pb.collection('club_memberships').update(existingMem.id, {
          status: 'approved',
          approvedAt: now,
          effectiveFrom: targetPeriod,
          notes: `Doação Mensal: R$ ${amount.toFixed(2)}`,
        }).catch(() => null);
      } else {
        await pb.collection('club_memberships').create({
          userId: user.id,
          userName: user.warName || user.name,
          cadetNumber: user.cadetNumber,
          squadron: user.squadron || '1º Esquadrão',
          clubId,
          clubName,
          status: 'approved',
          requestedAt: now,
          approvedAt: now,
          effectiveFrom: targetPeriod,
          notes: `Doação Mensal: R$ ${amount.toFixed(2)}`,
        }).catch(() => null);
      }

      // Sincronizar na prévia do próximo mês
      if (isBeforeDeadline) {
        await this.syncCadetPreviewOnDonationChange(user, clubId, clubName, amount, targetPeriod);
      }

      queryCache.clear();
      return true;
    } catch (error) {
      console.error('Erro ao definir doação:', error);
      return false;
    }
  }

  async cancelCadetReligiousDonation(
    userId: string,
    clubId: string,
    billingPeriod?: string
  ): Promise<boolean> {
    try {
      const users = await this.getUsers();
      const user = users.find((u) => u.id === userId);
      if (!user) throw new Error('Usuário não encontrado');

      const today = new Date();
      const config = await this.getScaerConfig();
      const currentPeriod = config?.currentBillingPeriod || getPeriodStr(today);
      const isBeforeDeadline = today.getDate() <= (config?.clubChangeDeadlineDay || 20);

      const targetPeriod = billingPeriod || (isBeforeDeadline
        ? getNextPeriod(currentPeriod)
        : getNextPeriod(getNextPeriod(currentPeriod)));

      const memberships = await this.getMemberships();
      const existingMem = memberships.find((m) => m.userId === userId && m.clubId === clubId);
      if (existingMem) {
        await pb.collection('club_memberships').update(existingMem.id, {
          status: 'inactive',
          effectiveFrom: targetPeriod,
        }).catch(() => null);
      }

      if (isBeforeDeadline) {
        await this.syncCadetPreviewOnDonationChange(user, clubId, '', 0, targetPeriod);
      }

      queryCache.clear();
      return true;
    } catch (error) {
      console.error('Erro ao cancelar doação:', error);
      return false;
    }
  }

  // Garantir prévia para um cadete
  async ensureCadetPreviewTransactions(cadetUser: User, nextPeriod?: string): Promise<Transaction[]> {
    try {
      const config = await this.getScaerConfig();
      const currentPeriod = config?.currentBillingPeriod || getPeriodStr(new Date());
      const targetPeriod = nextPeriod || getNextPeriod(currentPeriod);

      const existingTxs = (await pb.collection('transactions').getFullList({
        filter: `(userId="${cadetUser.id}" || cadetId="${cadetUser.id}" || cadetNumber="${cadetUser.cadetNumber}") && billingPeriod="${targetPeriod}"`,
      })) as unknown as Transaction[];

      const txsToCreate: Partial<Transaction>[] = [];

      // 1. Mensalidade SCAER na prévia
      const hasScaer = existingTxs.some(
        (t) => t.category === 'mensalidade_scaer' || t.description.includes('Mensalidade SCAER')
      );
      if (!hasScaer) {
        const scaerFee = config?.scaerMonthlyFee || 50;
        txsToCreate.push({
          userId: cadetUser.id,
          cadetId: cadetUser.id,
          cadetNumber: cadetUser.cadetNumber,
          cadetName: cadetUser.warName || cadetUser.name,
          userName: cadetUser.warName || cadetUser.name,
          clubId: 'SCAER',
          clubName: 'SCAER',
          description: 'Mensalidade SCAER (Prévia)',
          amount: scaerFee,
          category: 'mensalidade_scaer',
          billingPeriod: targetPeriod,
          type: 'automatic',
          status: 'preview',
          createdBy: 'system',
          createdByName: 'Sistema (Prévia)',
        });
      }

      // 2. Mensalidades dos Clubes na prévia
      const memberships = await this.getMemberships();
      const clubs = await this.getClubs();
      const userMems = memberships.filter(
        (m) =>
          (m.userId === cadetUser.id || m.cadetNumber === cadetUser.cadetNumber) &&
          (m.status === 'active' || m.status === 'approved' || m.status === 'pending_entry')
      );

      for (const mem of userMems) {
        const club = clubs.find((c) => c.id === mem.clubId);
        if (!club || !club.monthlyFee || club.monthlyFee <= 0) continue;

        const hasClubTx = existingTxs.some(
          (t) => t.clubId === club.id && (t.category === 'mensalidade_clube' || t.category === 'Mensalidade')
        );

        if (!hasClubTx) {
          txsToCreate.push({
            userId: cadetUser.id,
            cadetId: cadetUser.id,
            cadetNumber: cadetUser.cadetNumber,
            cadetName: cadetUser.warName || cadetUser.name,
            userName: cadetUser.warName || cadetUser.name,
            clubId: club.id,
            clubName: club.name,
            description: `Mensalidade ${club.name} (Prévia)`,
            amount: club.monthlyFee,
            category: 'mensalidade_clube',
            billingPeriod: targetPeriod,
            type: 'automatic',
            status: 'preview',
            createdBy: 'system',
            createdByName: 'Sistema (Prévia)',
          });
        }
      }

      // 3. Doações religiosas ativas
      const activeDonationMems = memberships.filter(
        (m) =>
          (m.userId === cadetUser.id || m.cadetNumber === cadetUser.cadetNumber) &&
          (m.status === 'active' || m.status === 'approved') &&
          m.notes && m.notes.includes('Doação Mensal')
      );

      for (const donMem of activeDonationMems) {
        const hasDonTx = existingTxs.some(
          (t) => t.clubId === donMem.clubId && t.category === 'doacao_religiosa'
        );
        if (!hasDonTx) {
          const match = donMem.notes?.match(/R\$\s*([\d,.]+)/);
          const amount = match ? parseFloat(match[1].replace(',', '.')) : 10;
          if (amount > 0) {
            txsToCreate.push({
              userId: cadetUser.id,
              cadetId: cadetUser.id,
              cadetNumber: cadetUser.cadetNumber,
              cadetName: cadetUser.warName || cadetUser.name,
              userName: cadetUser.warName || cadetUser.name,
              clubId: donMem.clubId,
              clubName: donMem.clubName,
              description: `Doação Mensal - ${donMem.clubName} (Prévia)`,
              amount,
              category: 'doacao_religiosa',
              billingPeriod: targetPeriod,
              type: 'recurring',
              status: 'preview',
              createdBy: cadetUser.id,
              createdByName: cadetUser.warName || cadetUser.name,
            });
          }
        }
      }

      if (txsToCreate.length > 0) {
        await Promise.all(
          txsToCreate.map((t) => pb.collection('transactions').create(t).catch(() => null))
        );
        queryCache.clear();
      }

      return await this.getTransactionsForCadet(cadetUser);
    } catch (err) {
      console.error('Erro ao garantir prévia do cadete:', err);
      return [];
    }
  }

  // Gerar prévias de todos os cadetes ativos
  async generateAllCadetsPreviews(targetPeriod?: string): Promise<{ cadetsProcessed: number }> {
    try {
      const config = await this.getScaerConfig();
      const currentPeriod = config?.currentBillingPeriod || getPeriodStr(new Date());
      const nextPeriod = targetPeriod || getNextPeriod(currentPeriod);

      const users = await this.getUsers();
      const cadets = users.filter((u) => u.role === 'cadete' || !u.role);

      let cadetsProcessed = 0;
      for (const cadet of cadets) {
        await this.ensureCadetPreviewTransactions(cadet, nextPeriod);
        cadetsProcessed++;
      }

      queryCache.clear();
      return { cadetsProcessed };
    } catch (err) {
      console.error('Erro ao gerar prévias de todos os cadetes:', err);
      throw err;
    }
  }

  // Consolidação definitiva do Dia 20
  async consolidateBillingOnDay20(targetPeriod?: string): Promise<{ convertedCount: number; period: string }> {
    try {
      const config = await this.getScaerConfig();
      const currentPeriod = config?.currentBillingPeriod || getPeriodStr(new Date());
      const period = targetPeriod || getNextPeriod(currentPeriod);

      // 1. Processar transições de membership pendentes para o período
      const memberships = await pb.collection('club_memberships').getFullList();
      for (const m of memberships) {
        if (m.status === 'pending_entry' && (!m.effectiveFrom || m.effectiveFrom <= period)) {
          await pb.collection('club_memberships').update(m.id, { status: 'active' }).catch(() => null);
        } else if (m.status === 'pending_exit' && (!m.effectiveFrom || m.effectiveFrom <= period)) {
          await pb.collection('club_memberships').update(m.id, { status: 'exited' }).catch(() => null);
        }
      }

      // 2. Converter todas as transações com status 'preview' para 'pending'
      const previewTxs = await pb.collection('transactions').getFullList({
        filter: `billingPeriod="${period}" && status="preview"`,
      });

      let convertedCount = 0;
      for (const tx of previewTxs) {
        const cleanDesc = (tx.description || '').replace(' (Prévia)', '');
        await pb.collection('transactions').update(tx.id, {
          status: 'pending',
          description: cleanDesc,
        }).catch(() => null);
        convertedCount++;
      }

      // 3. Atualizar resumo mensal
      await this.generateMonthlySummary(period);

      queryCache.clear();
      return { convertedCount, period };
    } catch (err) {
      console.error('Erro ao consolidar cobranças do dia 20:', err);
      throw err;
    }
  }

  // Verificação e Execução Autônoma de Faturamento (Self-healing e Gatilho do Dia 20)
  async checkAndRunAutonomousBilling(): Promise<{
    consolidated?: { convertedCount: number; period: string };
    previewsGenerated?: number;
    advancedPeriod?: string;
  }> {
    try {
      const config = await this.getScaerConfig();
      if (!config) return {};

      const now = new Date();
      const currentCalendarPeriod = getPeriodStr(now);
      const currentConfigPeriod = config.currentBillingPeriod || currentCalendarPeriod;
      const dayOfMonth = now.getDate();
      const nextPeriod = getNextPeriod(currentConfigPeriod);

      const result: {
        consolidated?: { convertedCount: number; period: string };
        previewsGenerated?: number;
        advancedPeriod?: string;
      } = {};

      // 1. Se o calendário atual for posterior ao período configurado, avançar período no config
      if (currentCalendarPeriod > currentConfigPeriod) {
        console.log(`[AutoBilling] Avançando período de faturamento de ${currentConfigPeriod} para ${currentCalendarPeriod}`);
        await pb.collection('scaer_config').update(config.id, {
          currentBillingPeriod: currentCalendarPeriod,
        }).catch(() => null);
        result.advancedPeriod = currentCalendarPeriod;
      }

      // 2. Regra do Dia 20:
      // Se dia do mês >= 20: consolidar cobranças de preview para definitivo ('pending') em nextPeriod
      if (dayOfMonth >= 20) {
        const previewCheck = await pb.collection('transactions').getList(1, 1, {
          filter: `billingPeriod="${nextPeriod}" && status="preview"`,
        }).catch(() => null);

        if (previewCheck && previewCheck.totalItems > 0) {
          console.log(`[AutoBilling] Dia 20 atingido. Consolidando ${previewCheck.totalItems} prévias do período ${nextPeriod}...`);
          const consRes = await this.consolidateBillingOnDay20(nextPeriod);
          result.consolidated = consRes;
        }

        // Uma vez consolidado o nextPeriod (M+1), preparar a prévia do mês seguinte (M+2)
        const m2Period = getNextPeriod(nextPeriod);
        const m2Check = await pb.collection('transactions').getList(1, 1, {
          filter: `billingPeriod="${m2Period}"`,
        }).catch(() => null);

        if (m2Check && m2Check.totalItems === 0) {
          console.log(`[AutoBilling] Gerando prévias provisórias para M+2 (${m2Period})...`);
          const genRes = await this.generateAllCadetsPreviews(m2Period);
          result.previewsGenerated = genRes.cadetsProcessed;
        }
      } else {
        // Antes do dia 20: Garantir que o período de prévia (nextPeriod) já possui os lançamentos gerados
        const octCheck = await pb.collection('transactions').getList(1, 1, {
          filter: `billingPeriod="${nextPeriod}"`,
        }).catch(() => null);

        if (octCheck && octCheck.totalItems === 0) {
          console.log(`[AutoBilling] Gerando prévias provisórias para ${nextPeriod}...`);
          const genRes = await this.generateAllCadetsPreviews(nextPeriod);
          result.previewsGenerated = genRes.cadetsProcessed;
        }
      }

      return result;
    } catch (err) {
      console.error('Erro na rotina de faturamento autônomo:', err);
      return {};
    }
  }

  // Importação em Lote Direta para o PocketBase

  async importBulkDataFromExcel(
    _newRoster: CadetRosterItem[],
    newTransactions: Partial<Transaction>[],
    _newExemptions: PendingExemption[],
    _newDesligados: DesligadoItem[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    if (onProgress) onProgress(10, 'Iniciando importação para o PocketBase remoto...');

    if (newTransactions.length > 0) {
      const chunkSize = 50;
      for (let i = 0; i < newTransactions.length; i += chunkSize) {
        const chunk = newTransactions.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map((item) =>
            pb.collection('transactions').create(item).catch(() => null)
          )
        );
        const pct = 10 + Math.floor(((i + chunk.length) / newTransactions.length) * 85);
        if (onProgress) onProgress(pct, `Enviados ${i + chunk.length} de ${newTransactions.length} lançamentos...`);
      }
    }

    if (onProgress) onProgress(100, 'Importação para o PocketBase concluída!');
    queryCache.clear();
  }

  // =============================================
  // Event Companies CRUD
  // =============================================

  async ensureEventCompaniesCollection(): Promise<void> {
    try {
      await pb.collection('event_companies').getList(1, 1);
    } catch {
      // Collection doesn't exist yet — try to create it via the API
      try {
        await pb.send('/api/collections', {
          method: 'POST',
          body: {
            name: 'event_companies',
            type: 'base',
            schema: [
              { name: 'name', type: 'text', required: true },
              { name: 'products', type: 'json', required: true },
            ],
            listRule: '',
            viewRule: '',
            createRule: '',
            updateRule: '',
            deleteRule: '',
          },
        });
        console.log('[EventCompanies] Coleção criada com sucesso.');
      } catch (createErr) {
        console.error('[EventCompanies] Erro ao criar coleção (pode já existir):', createErr);
      }
    }
  }

  async getEventCompanies(): Promise<EventCompany[]> {
    return queryCache.fetch('event_companies', async () => {
      try {
        const records = await pb.collection('event_companies').getFullList({ sort: 'name' });
        return records.map((r) => ({
          id: r.id,
          name: r.name as string,
          products: (typeof r.products === 'string' ? JSON.parse(r.products) : r.products) || [],
          created: r.created as string,
          updated: r.updated as string,
        })) as EventCompany[];
      } catch (error) {
        console.error('Erro ao buscar empresas de evento:', error);
        return [];
      }
    });
  }

  async createEventCompany(data: { name: string; products: { name: string; price: number; category: string }[] }): Promise<EventCompany | null> {
    try {
      await this.ensureEventCompaniesCollection();
      const record = await pb.collection('event_companies').create({
        name: data.name,
        products: data.products,
      });
      queryCache.clear('event_companies');
      return {
        id: record.id,
        name: record.name as string,
        products: (typeof record.products === 'string' ? JSON.parse(record.products) : record.products) || [],
        created: record.created as string,
        updated: record.updated as string,
      };
    } catch (error) {
      console.error('Erro ao criar empresa de evento:', error);
      return null;
    }
  }

  async updateEventCompany(id: string, data: { name?: string; products?: { name: string; price: number; category: string }[] }): Promise<EventCompany | null> {
    try {
      const record = await pb.collection('event_companies').update(id, data);
      queryCache.clear('event_companies');
      return {
        id: record.id,
        name: record.name as string,
        products: (typeof record.products === 'string' ? JSON.parse(record.products) : record.products) || [],
        created: record.created as string,
        updated: record.updated as string,
      };
    } catch (error) {
      console.error('Erro ao atualizar empresa de evento:', error);
      return null;
    }
  }

  async deleteEventCompany(id: string): Promise<boolean> {
    try {
      await pb.collection('event_companies').delete(id);
      queryCache.clear('event_companies');
      return true;
    } catch (error) {
      console.error('Erro ao excluir empresa de evento:', error);
      return false;
    }
  }

  // System Settings
  async getSystemSetting(key: string, defaultValue: string = ''): Promise<string> {
    try {
      const records = await pb.collection('system_settings').getFullList({ filter: `key="${key}"` });
      if (records.length > 0) return records[0].value;
      return defaultValue;
    } catch (err) {
      return defaultValue;
    }
  }

  async setSystemSetting(key: string, value: string): Promise<boolean> {
    try {
      const records = await pb.collection('system_settings').getFullList({ filter: `key="${key}"` });
      if (records.length > 0) {
        await pb.collection('system_settings').update(records[0].id, { value });
      } else {
        await pb.collection('system_settings').create({ key, value });
      }
      return true;
    } catch (err) {
      console.error('Erro ao salvar configuração:', err);
      return false;
    }
  }

  // Gestão de Eventos Históricos
  async getEventList(): Promise<string[]> {
    try {
      const raw = await this.getSystemSetting('event_list', '[]');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (e) {
      // ignore
    }
    const current = await this.getSystemSetting('current_event_name', 'Evento');
    return current ? [current] : ['Evento'];
  }

  async saveEventName(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return false;
    await this.setSystemSetting('current_event_name', trimmed);
    try {
      const list = await this.getEventList();
      if (!list.includes(trimmed)) {
        list.push(trimmed);
        await this.setSystemSetting('event_list', JSON.stringify(list));
      }
    } catch (e) {
      console.error('Erro ao atualizar lista de eventos:', e);
    }
    return true;
  }

  async getEventTransactions(): Promise<Transaction[]> {
    try {
      const records = await pb.collection('transactions').getFullList({
        filter: 'clubId="EVENTO"',
        sort: '-created',
      });
      return records as unknown as Transaction[];
    } catch (err) {
      console.error('Erro ao buscar transações de eventos:', err);
      return [];
    }
  }
}

export const DatabaseService = new DatabaseServiceClass();
