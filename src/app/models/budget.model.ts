export interface Expense {
  id: string;
  amount: number;
  date: string;
  note?: string;
  recurringId?: string;
}

export interface Category {
  /**
   * Stable Firestore document id. Carried through from the snapshot so a
   * category keeps its identity across renames and period migrations —
   * deriving the id from `period` + `name` instead meant a rename silently
   * re-keyed (and could collide with) another document.
   */
  id?: string;
  name: string;
  tone: string;
  amountLimit: number;
  amountSpent: number;
  expenses: Expense[];
  dueDay?: number | null;
  dueDate?: string | null;
  /**
   * Owning month as 'YYYY-MM'. Categories are per-period, so switching
   * months shows a different set. `null` means "not migrated yet" and is
   * treated as the current month (see `categoriesForPeriod`).
   */
  period?: string | null;
}

export interface IncomeSource {
  id: string;
  name: string;
  amount: number;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  tone: string;
}

export type RecurringFrequency = 'monthly' | 'weekly';

export interface RecurringExpense {
  id: string;
  categoryName: string;
  amount: number;
  note: string;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  dayOfWeek: number;
  lastAppliedPeriod: string;
  lastAppliedDate: string;
}

export interface AppSettings {
  displayName: string;
  selectedPeriod: string;
  rollLeftover: boolean;
  incomes: IncomeSource[];
  incomesByPeriod: Record<string, IncomeSource[]>;
  recurring: RecurringExpense[];
  targetSavings: number;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function currentPeriodKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  return currentPeriodKey(new Date(year, month - 1 + delta, 1));
}

export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const parsed = new Date(year, (month || 1) - 1, 1);
  if (isNaN(parsed.getTime())) {
    return period;
  }
  return parsed.toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
  });
}

export function expensePeriod(date: string): string {
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) {
    return '';
  }
  return currentPeriodKey(parsed);
}

export function expensesInPeriod(
  expenses: Expense[] | undefined,
  period: string
): Expense[] {
  return (expenses ?? []).filter(
    (expense) => expensePeriod(expense.date) === period
  );
}

export function sumExpenses(expenses: Expense[]): number {
  return expenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0);
}

export function periodSpent(category: Category, period: string): number {
  return sumExpenses(expensesInPeriod(category.expenses, period));
}

/**
 * Find the same-named category in the previous period. Categories are
 * per-period, so the previous month's data lives on a different object.
 */
export function siblingForPreviousPeriod(
  category: Category,
  categories: Category[],
  period: string
): Category | null {
  const previous = shiftPeriod(period, -1);
  const key = (category.name ?? '').trim().toLowerCase();
  if (!key) {
    return null;
  }
  return (
    (categories ?? []).find(
      (entry) =>
        categoryPeriod(entry) === previous &&
        (entry.name ?? '').trim().toLowerCase() === key
    ) ?? null
  );
}

/**
 * Unspent budget carried into `period`, read from the same-named category in
 * the PREVIOUS month.
 *
 * `previous` is required, and must be the prior month's sibling. Falling back
 * to `category` itself is what doubled every limit: a brand-new category has
 * no prior month, so `previous` is `null`, and the fallback computed
 * `category.amountLimit - periodSpent(category, previousPeriod)` — its own
 * limit minus zero. `effectiveLimit` then added that on top of the real
 * limit, so a 5000 category rendered as 10000. With no prior month there is
 * nothing to carry, so the answer is 0.
 */
export function leftoverFromPrevious(
  period: string,
  previous?: Category | null
): number {
  if (!previous) {
    return 0;
  }
  return Math.max(
    0,
    toNumber(previous.amountLimit) -
      periodSpent(previous, shiftPeriod(period, -1))
  );
}

export function effectiveLimit(
  category: Category,
  period: string,
  rollLeftover: boolean,
  allCategories?: Category[]
): number {
  if (!rollLeftover) {
    return toNumber(category.amountLimit);
  }

  const previous = allCategories
    ? siblingForPreviousPeriod(category, allCategories, period)
    : null;

  return (
    toNumber(category.amountLimit) + leftoverFromPrevious(period, previous)
  );
}

export function expenseTimestampForPeriod(period: string): string {
  const now = new Date();
  if (currentPeriodKey(now) === period) {
    return now.toISOString();
  }
  const [year, month] = period.split('-').map(Number);
  const day = Math.min(now.getDate(), 28);
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

export function defaultSettings(): AppSettings {
  return {
    displayName: '',
    selectedPeriod: currentPeriodKey(),
    rollLeftover: true,
    incomes: [],
    incomesByPeriod: {},
    recurring: [],
    targetSavings: 0,
  };
}

export function incomesForPeriod(
  settings: AppSettings,
  period: string
): IncomeSource[] {
  const key = /^\d{4}-\d{2}$/.test(period) ? period : currentPeriodKey();
  const fromMap = settings.incomesByPeriod?.[key];
  if (Array.isArray(fromMap)) {
    return fromMap;
  }
  if (
    Object.keys(settings.incomesByPeriod ?? {}).length === 0 &&
    key === (settings.selectedPeriod || currentPeriodKey())
  ) {
    return settings.incomes ?? [];
  }
  return [];
}

export function setIncomesForPeriod(
  settings: AppSettings,
  period: string,
  incomes: IncomeSource[]
): AppSettings {
  const key = /^\d{4}-\d{2}$/.test(period) ? period : currentPeriodKey();
  return {
    ...settings,
    incomes,
    incomesByPeriod: {
      ...(settings.incomesByPeriod ?? {}),
      [key]: incomes,
    },
  };
}

function isPeriodKey(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

/** The period a category belongs to, treating a missing value as "now". */
export function categoryPeriod(category: Category): string {
  return isPeriodKey(category?.period)
    ? (category.period as string)
    : currentPeriodKey();
}

/**
 * Stable identity for a category: its Firestore document id when it has one,
 * otherwise the same `YYYY-MM-name` shape the service used to derive. Callers
 * that need to match a category across a snapshot (which rebuilds every
 * object) should use this rather than `===` or a bare name compare.
 */
export function categoryKey(category: Category): string {
  const id = String(category?.id ?? '').trim();
  if (id) {
    return id;
  }
  return `${categoryPeriod(category)}::${(category.name ?? '').trim().toLowerCase()}`;
}

/** Only the categories belonging to `period`. */
export function categoriesForPeriod(
  categories: Category[],
  period: string
): Category[] {
  const key = isPeriodKey(period) ? period : currentPeriodKey();
  return (categories ?? []).filter(
    (category) => categoryPeriod(category) === key
  );
}

export function hasCategoriesForPeriod(
  categories: Category[],
  period: string
): boolean {
  return categoriesForPeriod(categories, period).length > 0;
}

/**
 * Copy a month's categories into another month. Only the shape is copied —
 * expenses are NOT carried over, because a new month should start at zero.
 * Category names that already exist in the target month are skipped.
 */
export function copyCategoriesToPeriod(
  categories: Category[],
  fromPeriod: string,
  toPeriod: string
): Category[] {
  const source = categoriesForPeriod(categories, fromPeriod);
  const target = new Set(
    categoriesForPeriod(categories, toPeriod).map((category) =>
      category.name.trim().toLowerCase()
    )
  );

  const copies: Category[] = [];

  for (const category of source) {
    const name = category.name.trim();
    const key = name.toLowerCase();
    if (!name || target.has(key)) {
      continue;
    }
    target.add(key);
    copies.push({
      name: category.name,
      tone: category.tone,
      amountLimit: toNumber(category.amountLimit),
      amountSpent: 0,
      expenses: [],
      dueDay: category.dueDay ?? null,
      dueDate: category.dueDate ?? null,
      period: isPeriodKey(toPeriod) ? toPeriod : currentPeriodKey(),
    });
  }

  return copies;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string): Date | null {
  const trimmed = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const [year, month, day] = trimmed.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function clampMonthDay(
  year: number,
  monthIndex: number,
  day: number
): Date {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, day), last));
}

export function nextMonthlyOccurrence(day: number, from = new Date()): Date {
  const candidate = clampMonthDay(from.getFullYear(), from.getMonth(), day);
  if (startOfDay(candidate).getTime() >= startOfDay(from).getTime()) {
    return candidate;
  }
  return clampMonthDay(from.getFullYear(), from.getMonth() + 1, day);
}

export function dueFieldsFromInput(value: string): {
  dueDate: string | null;
  dueDay: number | null;
} {
  const trimmed = String(value ?? '').trim();
  const parsed = parseDateKey(trimmed);
  if (parsed) {
    return { dueDate: toDateKey(parsed), dueDay: parsed.getDate() };
  }
  const day = parseInt(trimmed, 10);
  if (Number.isInteger(day) && day >= 1 && day <= 31) {
    return {
      dueDate: toDateKey(nextMonthlyOccurrence(day)),
      dueDay: day,
    };
  }
  return { dueDate: null, dueDay: null };
}

export function nextDueDate(
  category: Category,
  from = new Date()
): Date | null {
  const explicit = parseDateKey(String(category.dueDate ?? ''));
  if (
    explicit &&
    startOfDay(explicit).getTime() >= startOfDay(from).getTime()
  ) {
    return explicit;
  }
  const day = Number(category.dueDay);
  if (Number.isInteger(day) && day >= 1 && day <= 31) {
    return nextMonthlyOccurrence(day, from);
  }
  if (explicit) {
    return nextMonthlyOccurrence(explicit.getDate(), from);
  }
  return null;
}

export function formatDueLabel(
  category: Category,
  from = new Date()
): string {
  const next = nextDueDate(category, from);
  if (!next) {
    return '';
  }
  return next.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  });
}

export function dueThisWeek(
  categories: Category[],
  from = new Date()
): Category[] {
  const start = startOfDay(from);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return categories.filter((category) => {
    const next = nextDueDate(category, from);
    if (!next) {
      return false;
    }
    const time = startOfDay(next).getTime();
    return time >= start.getTime() && time < end.getTime();
  });
}

export function lastWeekdayOnOrBefore(
  dayOfWeek: number,
  from = new Date()
): Date {
  const weekday = ((Math.round(dayOfWeek) % 7) + 7) % 7;
  const date = startOfDay(from);
  const delta = (date.getDay() - weekday + 7) % 7;
  date.setDate(date.getDate() - delta);
  return date;
}

export const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const;

export const BILL_CATEGORY_PRESETS = [
  'Rent',
  'Electricity',
  'Water',
  'Internet',
  'Phone',
  'Subscriptions',
  'Insurance',
] as const;

export const EXPENSE_CATEGORY_PRESETS = [
  { name: 'Grocery', tone: 'shopping' },
  { name: 'Food', tone: 'shopping' },
  { name: 'Transport', tone: 'transport' },
  { name: 'Shopping', tone: 'shopping' },
  { name: 'Emergency', tone: 'emergency' },
] as const;

export function recurringSummary(item: RecurringExpense): string {
  if (item.frequency === 'weekly') {
    const weekday =
      WEEKDAY_OPTIONS.find((entry) => entry.value === item.dayOfWeek)?.label ??
      'weekly';
    return `every ${weekday}`;
  }
  return `day ${item.dayOfMonth}`;
}

export function allocatedToGoals(goals: SavingsGoal[]): number {
  return goals.reduce((sum, goal) => sum + toNumber(goal.savedAmount), 0);
}

export function unallocatedSavings(
  pool: number,
  goals: SavingsGoal[]
): number {
  return Math.max(0, toNumber(pool) - allocatedToGoals(goals));
}

export function totalIncome(incomes: IncomeSource[]): number {
  return incomes.reduce((sum, item) => sum + toNumber(item.amount), 0);
}

export function savingsPool(
  income: number,
  spent: number,
  unusedBudget: number
): number {
  if (toNumber(income) > 0) {
    return Math.max(0, toNumber(income) - toNumber(spent));
  }
  return Math.max(0, toNumber(unusedBudget));
}

export function goalProgressPercent(
  targetAmount: number,
  pool: number
): number {
  const target = toNumber(targetAmount);
  if (target <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((toNumber(pool) / target) * 100));
}
