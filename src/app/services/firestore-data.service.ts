import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_AUTH, FIREBASE_FIRESTORE } from '../core/firebase.tokens';
import {
  categoryPeriod,
  defaultSettings,
  type AppSettings,
  type Category,
  type Expense,
  type IncomeSource,
  type RecurringExpense,
  type SavingsGoal,
} from '../models/budget.model';

const SETTINGS_DOC_ID = 'app';
const SETTINGS_FIELD = 'targetSavings';

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeDocId(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const safe = trimmed.replace(/[/\\#?[\]]/g, '_');
  return encodeURIComponent(safe);
}

function normalizeExpense(raw: any, index: number): Expense {
  return {
    id: String(raw?.id ?? `${Date.now()}-${index}`),
    amount: toNumber(raw?.amount),
    date: String(raw?.date ?? new Date().toISOString()),
    note: String(raw?.note ?? '').trim(),
    recurringId: raw?.recurringId ? String(raw.recurringId) : undefined,
  };
}

function normalizeCategory(raw: any): Category {
  const expenses: Expense[] = Array.isArray(raw?.expenses)
    ? raw.expenses.map((item: any, index: number) =>
        normalizeExpense(item, index)
      )
    : [];

  const savedSpent = toNumber(raw?.amountSpent);
  const amountSpent =
    expenses.length > 0
      ? expenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0)
      : savedSpent;

  const dueDayRaw = toNumber(raw?.dueDay);
  const dueDay =
    dueDayRaw >= 1 && dueDayRaw <= 31 ? Math.round(dueDayRaw) : null;
  const dueDateRaw = String(raw?.dueDate ?? '').trim();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? dueDateRaw : null;
  const periodRaw = String(raw?.period ?? '').trim();
  const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : null;

  return {
    name: String(raw?.name ?? ''),
    tone: String(raw?.tone ?? 'emergency'),
    amountLimit: toNumber(raw?.amountLimit),
    amountSpent,
    expenses,
    dueDay,
    dueDate,
    period,
  };
}

function normalizeIncome(raw: any, index: number): IncomeSource {
  return {
    id: String(raw?.id ?? `income-${index}`),
    name: String(raw?.name ?? 'Income').trim() || 'Income',
    amount: toNumber(raw?.amount),
  };
}

function normalizeRecurring(raw: any, index: number): RecurringExpense {
  const day = Math.round(toNumber(raw?.dayOfMonth));
  const weekday = Math.round(toNumber(raw?.dayOfWeek));
  const frequency =
    String(raw?.frequency ?? '').toLowerCase() === 'weekly'
      ? 'weekly'
      : 'monthly';
  return {
    id: String(raw?.id ?? `recurring-${index}`),
    categoryName: String(raw?.categoryName ?? ''),
    amount: toNumber(raw?.amount),
    note: String(raw?.note ?? '').trim(),
    frequency,
    dayOfMonth: day >= 1 && day <= 31 ? day : 1,
    dayOfWeek: weekday >= 0 && weekday <= 6 ? weekday : 1,
    lastAppliedPeriod: String(raw?.lastAppliedPeriod ?? ''),
    lastAppliedDate: String(raw?.lastAppliedDate ?? '').trim(),
  };
}

function isPeriodKey(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function normalizeIncomeList(raw: unknown): IncomeSource[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item: any, index: number) => normalizeIncome(item, index));
}

function normalizeIncomesByPeriod(
  raw: any,
  fallbackIncomes: IncomeSource[],
  selectedPeriod: string
): Record<string, IncomeSource[]> {
  const byPeriod: Record<string, IncomeSource[]> = {};
  const source = raw?.incomesByPeriod;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source)) {
      if (isPeriodKey(key)) {
        byPeriod[key] = normalizeIncomeList(value);
      }
    }
  }
  if (!byPeriod[selectedPeriod] && fallbackIncomes.length > 0) {
    byPeriod[selectedPeriod] = fallbackIncomes;
  }
  return byPeriod;
}

function normalizeSettings(raw: any): AppSettings {
  const defaults = defaultSettings();
  const selected = String(raw?.selectedPeriod ?? '');
  const selectedPeriod = isPeriodKey(selected)
    ? selected
    : defaults.selectedPeriod;
  const fallbackIncomes = normalizeIncomeList(raw?.incomes);
  const incomesByPeriod = normalizeIncomesByPeriod(
    raw,
    fallbackIncomes,
    selectedPeriod
  );
  return {
    displayName: String(raw?.displayName ?? ''),
    selectedPeriod,
    rollLeftover: raw?.rollLeftover !== false,
    incomes: incomesByPeriod[selectedPeriod] ?? fallbackIncomes,
    incomesByPeriod,
    recurring: Array.isArray(raw?.recurring)
      ? raw.recurring.map((item: any, index: number) =>
          normalizeRecurring(item, index)
        )
      : [],
    targetSavings: toNumber(raw?.[SETTINGS_FIELD]),
  };
}

function normalizeGoal(raw: any, fallbackId: string): SavingsGoal {
  return {
    id: String(raw?.id ?? fallbackId),
    name: String(raw?.name ?? 'Savings').trim() || 'Savings',
    targetAmount: toNumber(raw?.targetAmount),
    savedAmount: Math.max(0, toNumber(raw?.savedAmount)),
    tone: String(raw?.tone ?? 'goal'),
  };
}

function serializeIncome(item: IncomeSource): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    amount: toNumber(item.amount),
  };
}

function serializeSettings(settings: AppSettings): Record<string, unknown> {
  const period = /^\d{4}-\d{2}$/.test(settings.selectedPeriod)
    ? settings.selectedPeriod
    : defaultSettings().selectedPeriod;
  const incomesByPeriod: Record<string, ReturnType<typeof serializeIncome>[]> =
    {};
  for (const [key, value] of Object.entries(settings.incomesByPeriod ?? {})) {
    if (/^\d{4}-\d{2}$/.test(key)) {
      incomesByPeriod[key] = (value ?? []).map(serializeIncome);
    }
  }
  const currentIncomes = (
    incomesByPeriod[period]
      ? settings.incomesByPeriod?.[period]
      : settings.incomes
  )?.map(serializeIncome) ?? [];
  incomesByPeriod[period] = currentIncomes;
  return {
    displayName: settings.displayName,
    selectedPeriod: settings.selectedPeriod,
    rollLeftover: settings.rollLeftover,
    incomes: currentIncomes,
    incomesByPeriod,
    recurring: settings.recurring.map((item) => ({
      id: item.id,
      categoryName: item.categoryName,
      amount: toNumber(item.amount),
      note: item.note,
      frequency: item.frequency === 'weekly' ? 'weekly' : 'monthly',
      dayOfMonth: item.dayOfMonth,
      dayOfWeek: item.dayOfWeek,
      lastAppliedPeriod: item.lastAppliedPeriod,
      lastAppliedDate: item.lastAppliedDate,
    })),
    [SETTINGS_FIELD]: toNumber(settings.targetSavings),
  };
}

@Injectable({ providedIn: 'root' })
export class FirestoreDataService {
  private readonly auth = inject<Auth>(FIREBASE_AUTH);
  private readonly firestore = inject<Firestore>(FIREBASE_FIRESTORE);


  private uidOrThrow(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('Not authenticated.');
    }
    return uid;
  }

  private categoriesPath(uid: string): string {
    return `users/${uid}/categories`;
  }

  private goalsPath(uid: string): string {
    return `users/${uid}/goals`;
  }

  private settingsPath(uid: string): string {
    return `users/${uid}/settings/${SETTINGS_DOC_ID}`;
  }

  watchCategories(): Observable<Category[]> {
    return new Observable<Category[]>((subscriber) => {
      let snapUnsub: (() => void) | undefined;
      const authUnsub = onAuthStateChanged(
        this.auth,
        (user) => {
          snapUnsub?.();
          snapUnsub = undefined;
          if (!user) {
            subscriber.next([]);
            return;
          }
          const colRef = collection(
            this.firestore,
            this.categoriesPath(user.uid)
          );
          snapUnsub = onSnapshot(
            colRef,
            (snap) => {
              subscriber.next(
                snap.docs.map((d) => normalizeCategory(d.data()))
              );
            },
            (err) => subscriber.error(err)
          );
        },
        (err) => subscriber.error(err)
      );
      return () => {
        snapUnsub?.();
        authUnsub();
      };
    });
  }

  watchSettings(): Observable<AppSettings> {
    return new Observable<AppSettings>((subscriber) => {
      let snapUnsub: (() => void) | undefined;
      const authUnsub = onAuthStateChanged(
        this.auth,
        (user) => {
          snapUnsub?.();
          snapUnsub = undefined;
          if (!user) {
            subscriber.next(defaultSettings());
            return;
          }
          const docRef = doc(this.firestore, this.settingsPath(user.uid));
          snapUnsub = onSnapshot(
            docRef,
            (snap) => subscriber.next(normalizeSettings(snap.data())),
            (err) => subscriber.error(err)
          );
        },
        (err) => subscriber.error(err)
      );
      return () => {
        snapUnsub?.();
        authUnsub();
      };
    });
  }

  watchSavingsGoal(): Observable<number> {
    return new Observable<number>((subscriber) => {
      const sub = this.watchSettings().subscribe({
        next: (settings) => subscriber.next(toNumber(settings.targetSavings)),
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => sub.unsubscribe();
    });
  }

  watchGoals(): Observable<SavingsGoal[]> {
    return new Observable<SavingsGoal[]>((subscriber) => {
      let snapUnsub: (() => void) | undefined;
      const authUnsub = onAuthStateChanged(
        this.auth,
        (user) => {
          snapUnsub?.();
          snapUnsub = undefined;
          if (!user) {
            subscriber.next([]);
            return;
          }
          const colRef = collection(this.firestore, this.goalsPath(user.uid));
          snapUnsub = onSnapshot(
            colRef,
            (snap) => {
              subscriber.next(
                snap.docs.map((d) =>
                  normalizeGoal({ id: d.id, ...d.data() }, d.id)
                )
              );
            },
            (err) => subscriber.error(err)
          );
        },
        (err) => subscriber.error(err)
      );
      return () => {
        snapUnsub?.();
        authUnsub();
      };
    });
  }

  async saveCategories(categories: Category[]): Promise<void> {
    const uid = this.uidOrThrow();
    const colRef = collection(this.firestore, this.categoriesPath(uid));

    const seen = new Set<string>();
    const batch = writeBatch(this.firestore);
    for (const cat of categories) {
      // Categories are per-period, so the doc id must include the period.
      // Otherwise the same category name in two different months would
      // resolve to one document and silently overwrite the other.
      const id = sanitizeDocId(`${categoryPeriod(cat)}-${cat.name}`);
      if (!id) {
        continue;
      }
      seen.add(id);
      const ref = doc(this.firestore, this.categoriesPath(uid), id);
      const expenses = Array.isArray(cat.expenses) ? cat.expenses : [];
      const amountSpent = expenses.reduce(
        (sum, e) => sum + toNumber(e.amount),
        0
      );
      const dueDay = toNumber(cat.dueDay);
      const dueDateRaw = String(cat.dueDate ?? '').trim();
      batch.set(ref, {
        name: cat.name,
        tone: cat.tone,
        amountLimit: toNumber(cat.amountLimit),
        amountSpent,
        dueDay: dueDay >= 1 && dueDay <= 31 ? Math.round(dueDay) : null,
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? dueDateRaw : null,
        period: categoryPeriod(cat),
        expenses: expenses.map((e) => ({
          id: String(e.id),
          amount: toNumber(e.amount),
          date: String(e.date),
          note: String(e.note ?? '').trim(),
          recurringId: e.recurringId ? String(e.recurringId) : null,
        })),
      });
    }
    await batch.commit();

    const existing = await getDocs(colRef);
    const stale = existing.docs.filter((d) => !seen.has(d.id));
    await Promise.all(
      stale.map((d) =>
        deleteDoc(doc(this.firestore, this.categoriesPath(uid), d.id))
      )
    );
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const uid = this.uidOrThrow();
    const ref = doc(this.firestore, this.settingsPath(uid));
    await setDoc(ref, serializeSettings(settings), { merge: true });
  }

  async saveDisplayName(displayName: string): Promise<void> {
    const uid = this.uidOrThrow();
    const ref = doc(this.firestore, this.settingsPath(uid));
    await setDoc(ref, { displayName: displayName.trim() }, { merge: true });
  }

  async saveSavingsGoal(amount: number): Promise<void> {
    const uid = this.uidOrThrow();
    const ref = doc(this.firestore, this.settingsPath(uid));
    await setDoc(ref, { [SETTINGS_FIELD]: toNumber(amount) }, { merge: true });
  }

  async saveGoals(goals: SavingsGoal[]): Promise<void> {
    const uid = this.uidOrThrow();
    const colRef = collection(this.firestore, this.goalsPath(uid));
    const seen = new Set<string>();
    const batch = writeBatch(this.firestore);

    for (const goal of goals) {
      const id = String(goal.id || sanitizeDocId(goal.name)).trim();
      if (!id) {
        continue;
      }
      seen.add(id);
      const ref = doc(this.firestore, this.goalsPath(uid), id);
      batch.set(ref, {
        id,
        name: goal.name,
        targetAmount: toNumber(goal.targetAmount),
        savedAmount: Math.max(0, toNumber(goal.savedAmount)),
        tone: goal.tone || 'goal',
      });
    }
    await batch.commit();

    const existing = await getDocs(colRef);
    const stale = existing.docs.filter((d) => !seen.has(d.id));
    await Promise.all(
      stale.map((d) =>
        deleteDoc(doc(this.firestore, this.goalsPath(uid), d.id))
      )
    );

    const total = goals.reduce(
      (sum, goal) => sum + toNumber(goal.targetAmount),
      0
    );
    await this.saveSavingsGoal(total);
  }
}
