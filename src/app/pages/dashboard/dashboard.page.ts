
import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { signOut, updateProfile } from 'firebase/auth';
import type { Auth } from 'firebase/auth';

import {
  IonContent,
  IonIcon,
  IonModal,
  IonButton,
  IonInput,
  IonSelect,
  IonSelectOption,
  ToastController,
} from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  chevronBackOutline,
  chevronDownOutline,
  chevronForwardOutline,
  imageOutline,
  closeOutline,
  warningOutline,
} from 'ionicons/icons';

import { FIREBASE_AUTH } from '../../core/firebase.tokens';
import { FirestoreDataService } from '../../services/firestore-data.service';
import {
  categoriesForPeriod,
  categoryKey,
  categoryPeriod,
  copyCategoriesToPeriod,
  currentPeriodKey,
  defaultSettings,
  dueFieldsFromInput,
  dueThisWeek,
  effectiveLimit,
  expenseTimestampForPeriod,
  expensesInPeriod,
  formatDueLabel,
  goalProgressPercent,
  incomesForPeriod,
  lastWeekdayOnOrBefore,
  leftoverFromPrevious,
  periodLabel,
  periodSpent,
  recurringSummary,
  siblingForPreviousPeriod,
  savingsPool,
  setIncomesForPeriod,
  shiftPeriod,
  toDateKey,
  totalIncome,
  unallocatedSavings,
  BILL_CATEGORY_PRESETS,
  EXPENSE_CATEGORY_PRESETS,
  WEEKDAY_OPTIONS,
  type AppSettings,
  type Category,
  type Expense,
  type IncomeSource,
  type RecurringExpense,
  type SavingsGoal,
} from '../../models/budget.model';

// INTERFACES

export type { Category, Expense } from '../../models/budget.model';

export interface CardColor {
  tone: string;
  hex: string;
  label: string;
}



// DASHBOARD


@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  imports: [
    IonContent,
    IonIcon,
    IonModal,
    IonButton,
    IonInput,
    IonSelect,
    IonSelectOption,
    FormsModule,
    CommonModule,
  ],
})
export class DashboardPage implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly dataService = inject(FirestoreDataService);
  private readonly toastController = inject(ToastController);
  private readonly auth = inject<Auth>(FIREBASE_AUTH);



  private readonly dataSubs = new Subscription();


  /*   REACTIVE STATE

   * This app runs zoneless (`angular.json` ships no `zone.js`), and Firestore
   * delivers `onSnapshot` callbacks outside Angular's scheduler. Plain fields
   * assigned from those callbacks never re-rendered — the UI only refreshed
   * when some unrelated event (a click, an ngModel write) happened to run
   * change detection. That is why categories appeared to vanish on load and
   * "come back" on tap.
   *
   * Every piece of async-backed state is therefore a signal. The getters and
   * setters keep the existing call sites, the template, and the unit tests
   * working unchanged, while a signal write now schedules CD on its own.
   */


  // DASHBOARD DATA


  private readonly monthSignal = signal(periodLabel(currentPeriodKey()));

  get month(): string {
    return this.monthSignal();
  }

  set month(value: string) {
    this.monthSignal.set(value);
  }

  private readonly targetGoalSignal = signal(0);

  get targetGoal(): number {
    return this.targetGoalSignal();
  }

  set targetGoal(value: number) {
    this.targetGoalSignal.set(value);
  }

  private readonly displayNameSignal = signal('');

  get displayName(): string {
    return this.displayNameSignal();
  }

  set displayName(value: string) {
    this.displayNameSignal.set(value);
  }

  private readonly settingsSignal = signal<AppSettings>(defaultSettings());

  get settings(): AppSettings {
    return this.settingsSignal();
  }

  set settings(value: AppSettings) {
    this.settingsSignal.set(value);
  }

  private readonly savingsGoalsSignal = signal<SavingsGoal[]>([]);

  get savingsGoals(): SavingsGoal[] {
    return this.savingsGoalsSignal();
  }

  set savingsGoals(value: SavingsGoal[]) {
    this.savingsGoalsSignal.set(value);
  }

  newIncome = {
    name: '',
    amount: '',
  };

  newRecurring = {
    categoryName: '',
    amount: '',
    note: '',
    frequency: 'monthly' as 'monthly' | 'weekly',
    dayOfMonth: '1',
    dayOfWeek: '1',
  };

  weekdayOptions = WEEKDAY_OPTIONS;

  billPresets = BILL_CATEGORY_PRESETS;

  expensePresets = EXPENSE_CATEGORY_PRESETS;

  private readonly goalDepositsSignal = signal<Record<string, string>>({});

  get goalDeposits(): Record<string, string> {
    return this.goalDepositsSignal();
  }

  set goalDeposits(value: Record<string, string>) {
    this.goalDepositsSignal.set(value);
  }

  addIncomeOpen = false;

  profileOpen = false;

  editDisplayName = '';

  addRecurringOpen = false;

  addNoteInput = '';

  editExpenseNote = '';

  editCategoryDueDate = '';

  private categoriesReady = false;

  private settingsReady = false;

  private recurringAppliedOn = '';

  menuOpen = false;

  profileMenuOpen = false;



  // ADD CATEGORY


  addCategoryOpen = false;

  newCategory = {
    title: '',
    amountLimit: '',
    color: 'emergency',
  };



  // EDIT CATEGORY


  editingCategory = false;

  editCategoryName = '';

  editCategoryLimit = '';

  editCategoryColor = 'emergency';



  // ADD TARGET SAVINGS


  addSavingsOpen = false;

  newSavings = {
    title: '',
    targetAmount: '',
    savedAmount: '',
  };



  // CATEGORY DETAIL


  categoryDetailOpen = false;

  /**
   * Held as a key rather than an object reference. `watchCategories()`
   * rebuilds every Category on each snapshot, so a stored reference goes
   * stale immediately; resolving through `selectedCategoryKey` means the
   * detail sheet always reads live data.
   */
  private readonly selectedCategoryKey = signal<string | null>(null);

  private readonly selectedCategoryNameSignal = signal<string | null>(null);

  private readonly selectedCategoryPeriodSignal = signal<string | null>(null);

  get selectedCategory(): Category | null {
    const id = this.selectedCategoryKey();
    if (id !== null) {
      const match = this.categories.find(
        (category) => categoryKey(category) === id
      );
      if (match) {
        return match;
      }
    }
    // Fall back to the name/period pair for entries that predate stable ids.
    const name = this.selectedCategoryNameSignal();
    const period = this.selectedCategoryPeriodSignal();
    if (name === null) {
      return null;
    }
    return (
      this.categories.find(
        (category) =>
          (category.name ?? '') === name &&
          (period === null || categoryPeriod(category) === period)
      ) ?? null
    );
  }

  set selectedCategory(value: Category | null) {
    if (value === null) {
      this.selectedCategoryKey.set(null);
      this.selectedCategoryNameSignal.set(null);
      this.selectedCategoryPeriodSignal.set(null);
      return;
    }
    this.selectedCategoryKey.set(categoryKey(value));
    this.selectedCategoryNameSignal.set(value.name ?? null);
    this.selectedCategoryPeriodSignal.set(
      /^\d{4}-\d{2}$/.test(String(value.period ?? ''))
        ? (value.period as string)
        : null
    );
  }

  addAmountInput = '';



  // EDIT EXPENSE


  editingExpenseId: string | null = null;

  editExpenseInput = '';



  // SUMMARY


  summaryOpen = false;


  
  // CARD COLORS
  

  cardColors: CardColor[] = [

    {
      tone: 'emergency',
      hex: '#ffc2c2',
      label: 'Emergency',
    },

    {
      tone: 'transport',
      hex: '#d8a4a4',
      label: 'Transport',
    },

    {
      tone: 'shopping',
      hex: '#e1c1b3',
      label: 'Shopping',
    },

    {
      tone: 'bills',
      hex: '#cbb9b1',
      label: 'Bills',
    },

    {
      tone: 'goal',
      hex: '#c8d1d9',
      label: 'Other',
    },

  ];


  
  // CATEGORIES


  private readonly categoriesSignal = signal<Category[]>([]);

  /**
   * Every category the user owns, across all months. This is the single
   * source of truth that gets persisted — `saveCategories()` writes the whole
   * list. `periodCategories` is the per-month view the UI renders.
   */
  get categories(): Category[] {
    return this.categoriesSignal();
  }

  set categories(value: Category[]) {
    this.categoriesSignal.set(value);
  }


  
  // QUICK ACTIONS
  

  actions = [

    {
      label: 'Add New Category',
      handler: () => this.openAddCategory(),
    },

    {
      label: 'Add Target Savings',
      handler: () => this.openAddSavings(),
    },

    {
      label: 'Add Income',
      handler: () => this.openAddIncome(),
    },

    {
      label: 'View Summary',
      handler: () => this.openSummary(),
    },

    {
      label: 'Dashboard',
      handler: () =>
        this.router.navigateByUrl(
          '/dashboard-overview'
        ),
    },

  ];

  /* Account actions live in the profile menu, not the action dropdown. */
  profileActions = [

    {
      label: 'Edit display name',
      handler: () => this.openEditProfile(),
    },

    {
      label: 'Log Out',
      handler: () => void this.logout(),
    },

  ];

  toggleProfileMenu(
    event: Event
  ): void {

    event.stopPropagation();

    this.menuOpen = false;

    this.profileMenuOpen =
      !this.profileMenuOpen;

  }


  /**
   * Dismiss both menus on an outside click. The hover handlers that used to
   * do this are gone, and both triggers call `stopPropagation()`, so without
   * this there is no way to close a menu except re-tapping its own button.
   */
  @HostListener('document:click')
  closeMenusOnOutsideClick(): void {

    this.menuOpen = false;

    this.profileMenuOpen = false;

  }


  onProfileActionClick(
    action: {
      label: string;
      handler: () => void;
    }
  ): void {

    this.profileMenuOpen = false;

    action.handler();

  }


  // SEARCH + FILTER


  private readonly searchQuerySignal = signal('');

  get searchQuery(): string {
    return this.searchQuerySignal();
  }

  set searchQuery(value: string) {
    this.searchQuerySignal.set(value);
  }

  private readonly activeToneSignal = signal<string | null>(null);

  get activeTone(): string | null {
    return this.activeToneSignal();
  }

  set activeTone(value: string | null) {
    this.activeToneSignal.set(value);
  }

  private categoryPeriodsMigrated = false;

  readonly toneFilters = [
    { tone: 'all', label: 'All' },
    { tone: 'emergency', label: 'Emergency' },
    { tone: 'transport', label: 'Transport' },
    { tone: 'shopping', label: 'Shopping' },
    { tone: 'bills', label: 'Bills' },
    { tone: 'goal', label: 'Other' },
  ];


  /**
   * Every category the user owns, across all months. This is the single
   * source of truth that gets persisted — `saveCategories()` writes the whole
   * list. `periodCategories` is the per-month view the UI renders.
   */
  get allCategories(): Category[] {
    return this.categories;
  }


  /** Only the categories belonging to the month being viewed. */
  get periodCategories(): Category[] {
    return categoriesForPeriod(
      this.categories,
      this.selectedPeriod
    );
  }


  get hasCategories(): boolean {
    return this.periodCategories.length > 0;
  }


  get hasAnyCategories(): boolean {
    return this.categories.length > 0;
  }


  get isPeriodUnset(): boolean {
    return (
      this.categoriesReady &&
      !this.hasCategories &&
      this.selectedPeriod === currentPeriodKey()
    );
  }


  get isPeriodEmpty(): boolean {
    return this.categoriesReady && !this.hasCategories;
  }


  get hasActiveFilters(): boolean {
    return (
      this.searchQuery.trim().length > 0 ||
      this.activeTone !== null
    );
  }


  /**
   * Name search and tone filter combine. `activeTone === null` means "All",
   * so it never narrows anything on its own.
   */
  get visibleCategories(): Category[] {
    const query =
      this.searchQuery.trim().toLowerCase();

    return this.periodCategories.filter(
      (category) => {
        const matchesQuery =
          query.length === 0 ||
          (category.name ?? '')
            .toLowerCase()
            .includes(query);

        const matchesTone =
          this.activeTone === null ||
          category.tone === this.activeTone;

        return matchesQuery && matchesTone;
      }
    );
  }


  setToneFilter(
    tone: string
  ): void {

    this.activeTone =
      tone === 'all' ? null : tone;

  }


  clearFilters(): void {

    this.searchQuery = '';

    this.activeTone = null;

  }


  
  // DERIVED VALUES
  

  get anyModalOpen(): boolean {

    return (
      this.categoryDetailOpen ||
      this.addCategoryOpen ||
      this.addSavingsOpen ||
      this.addIncomeOpen ||
      this.profileOpen ||
      this.addRecurringOpen ||
      this.summaryOpen
    );

  }


  get selectedPeriod(): string {
    return this.settings.selectedPeriod || currentPeriodKey();
  }

  get rollLeftover(): boolean {
    return this.settings.rollLeftover !== false;
  }

  get totalSpent(): number {
    return this.periodCategories.reduce(
      (sum, category) => sum + this.spentOf(category),
      0
    );
  }

  get totalLimit(): number {
    return this.periodCategories.reduce(
      (sum, category) => sum + this.limitOf(category),
      0
    );
  }

  get periodIncomes(): IncomeSource[] {
    return incomesForPeriod(this.settings, this.selectedPeriod);
  }

  get incomeTotal(): number {
    return totalIncome(this.periodIncomes);
  }

  get cashRemaining(): number {
    return this.incomeTotal - this.totalSpent;
  }

  get isCurrentPeriod(): boolean {
    return this.selectedPeriod === currentPeriodKey();
  }

  get savingsAvailable(): number {
    return savingsPool(
      this.incomeTotal,
      this.totalSpent,
      this.totalRemaining
    );
  }

  get unallocated(): number {
    return unallocatedSavings(this.savingsAvailable, this.savingsGoals);
  }

  get greetingName(): string {
    return (
      this.displayName.trim() ||
      this.auth.currentUser?.displayName?.trim() ||
      this.auth.currentUser?.email?.split('@')[0] ||
      ''
    );
  }

  get dueSoon(): Category[] {
    return dueThisWeek(
      this.periodCategories
    );
  }

  get visibleGoals(): SavingsGoal[] {
    if (this.savingsGoals.length > 0) {
      return this.savingsGoals;
    }
    if (this.targetGoal > 0) {
      return [
        {
          id: 'legacy',
          name: 'Target Savings',
          targetAmount: this.targetGoal,
          savedAmount: 0,
          tone: 'goal',
        },
      ];
    }
    return [];
  }


  get totalRemaining(): number {

    return (
      this.totalLimit -
      this.totalSpent
    );

  }


  get totalSaved(): number {

    return Math.max(
      0,
      this.totalRemaining
    );

  }


  
  // CONSTRUCTOR
  

  constructor() {

    addIcons({

      imageOutline,

      chevronDownOutline,

      chevronBackOutline,

      chevronForwardOutline,

      closeOutline,

      warningOutline,

    });

  }


  
  // INITIALIZE
  

  ngOnInit(): void {

    this.loadCategories();

    this.loadSavingsGoal();

    this.loadSettings();

    this.loadGoals();

  }


  ngOnDestroy(): void {

    this.dataSubs.unsubscribe();

  }


  async logout(): Promise<void> {

    try {

      await signOut(this.auth);

    } catch (error) {

       console.error(
        ...oo_tx(`106366631_680_6_683_7_11`,'Failed to log out:',
        error)
      );

    }

    await this.router.navigateByUrl(
      '/welcome'
    );

  }


  
  // NUMBER HELPER
  

  private toNumber(
    value: unknown
  ): number {

    const number =
      Number(value);

    return Number.isFinite(number)
      ? number
      : 0;

  }


  
  // NOTIFY OTHER PAGES
  // Kept for compatibility; live updates now come from Firestore listeners.


  private notifyCategoriesChanged(): void {

    return;

  }


  
  // SAVE CATEGORIES
  

  private saveCategories(): void {

    // Rebuild the list with recalculated `amountSpent` rather than mutating
    // in place. `this.categories` is a signal, so an in-place edit would
    // save the corrected totals to Firestore without ever updating the view.
    this.categories = this.categories.map((category) => {

      const expenses = Array.isArray(category.expenses)
        ? category.expenses
        : [];

      return {
        ...category,
        expenses,
        amountSpent: expenses.reduce(
          (sum, expense) => sum + this.toNumber(expense.amount),
          0
        ),
      };

    });

    void this.dataService.saveCategories(
      this.categories
    ).catch(
      error => {

         console.error(
          ...oo_tx(`106366631_751_8_754_9_11`,'Failed to save categories:',
          error)
        );

      }
    );

  }


  
  // LOAD CATEGORIES
  

  /**
   * One-time migration: categories written before periods existed have no
   * `period` field. Stamp them with the current month and persist, which
   * rewrites their doc ids to the new `YYYY-MM-name` format.
   *
   * Only latches once it has actually seen a non-empty list. Previously an
   * initial empty snapshot (signed out, or an offline cold start) satisfied
   * `needsMigration === false` and set the latch, so the migration could
   * never run again for the life of the page — leaving legacy documents to
   * be handled only by the write path.
   */
  private migrateCategoryPeriods(): void {

    if (this.categoryPeriodsMigrated) {

      return;

    }


    if (this.categories.length === 0) {

      // Nothing to migrate yet — stay un-latched and re-check on the next
      // snapshot once real data arrives.
      return;

    }


    const needsMigration =
      this.categories.some(
        (category) =>
          !/^\d{4}-\d{2}$/.test(String(category.period ?? ''))
      );

    if (!needsMigration) {

      this.categoryPeriodsMigrated = true;
      return;

    }


    const now =
      currentPeriodKey();

    this.categories =
      this.categories.map(
        (category) => ({
          ...category,
          period: /^\d{4}-\d{2}$/.test(String(category.period ?? ''))
            ? category.period
            : now,
        })
      );

    this.categoryPeriodsMigrated = true;

    this.saveCategories();

  }


  /**
   * Seed the current month from the previous one. Only the category shape is
   * copied — expenses are not carried over, so the new month starts at zero.
   */
  copyPreviousMonthCategories(): void {

    const target =
      this.selectedPeriod;

    const previous =
      shiftPeriod(target, -1);

    const copies =
      copyCategoriesToPeriod(
        this.categories,
        previous,
        target
      );

    if (copies.length === 0) {

      void this.showToast(
        'Nothing to copy from the previous month.',
        'warning'
      );

      return;

    }

    this.categories = [
      ...this.categories,
      ...copies,
    ];

    this.saveCategories();

    void this.showToast(
      `Copied ${copies.length} categor${copies.length === 1 ? 'y' : 'ies'} from ${periodLabel(previous)}.`,
      'success'
    );

  }


  private loadCategories(): void {

    this.dataSubs.add(
      this.dataService.watchCategories().subscribe({

        next: categories => {

          // Assigning through the signal-backed setter is what schedules
          // change detection. This callback fires from Firestore's transport,
          // outside Angular, so a plain field assignment here would render
          // nothing until the user happened to click something.
          this.categories = categories;

          this.categoriesReady = true;

          this.migrateCategoryPeriods();

          this.applyDueRecurring();

          // `selectedCategory` is stored as a key and resolved on read, so
          // this snapshot rebuilding every object needs no manual re-linking.

        },

        error: error => {

           console.error(
            ...oo_tx(`106366631_898_10_901_11_11`,'Failed to load categories:',
            error)
          );

          this.categories = [];
          this.categoriesReady = true;

        },

      })
    );

  }


  
  // SAVE SAVINGS GOAL
  

  private saveSavingsGoal(): void {

    void this.dataService.saveSavingsGoal(
      this.targetGoal
    ).catch(
      error => {

         console.error(
          ...oo_tx(`106366631_925_8_928_9_11`,'Failed to save savings goal:',
          error)
        );

      }
    );

  }


  
  // LOAD SAVINGS GOAL
  

  private loadSavingsGoal(): void {

    this.dataSubs.add(
      this.dataService.watchSavingsGoal().subscribe({

        next: goal => {

          this.targetGoal =
            this.toNumber(goal);

        },

        error: error => {

           console.error(
            ...oo_tx(`106366631_954_10_957_11_11`,'Failed to load savings goal:',
            error)
          );

          this.targetGoal = 0;

        },

      })
    );

  }


  private loadSettings(): void {

    this.dataSubs.add(
      this.dataService.watchSettings().subscribe({

        next: settings => {

          this.settings = settings;

          this.month = periodLabel(this.selectedPeriod);

          this.displayName =
            settings.displayName.trim() ||
            this.auth.currentUser?.displayName?.trim() ||
            '';

          if (
            !settings.displayName.trim() &&
            this.displayName
          ) {
            this.settings = {
              ...this.settings,
              displayName: this.displayName,
            };
            this.persistSettings();
          }

          this.settingsReady = true;

          this.applyDueRecurring();

        },

        error: error => {

           console.error(
            ...oo_tx(`106366631_1004_10_1007_11_11`,'Failed to load settings:',
            error)
          );

          this.settingsReady = true;

        },

      })
    );

  }


  private loadGoals(): void {

    this.dataSubs.add(
      this.dataService.watchGoals().subscribe({

        next: goals => {

          this.savingsGoals = goals;

          // Immutable update: mutating `this.goalDeposits` in place would
          // write to the object a signal already handed out, and the view
          // would not be notified.
          const deposits = { ...this.goalDeposits };

          for (const goal of goals) {
            if (!(goal.id in deposits)) {
              deposits[goal.id] = '';
            }
          }

          this.goalDeposits = deposits;

          this.migrateLegacyGoal(goals);

        },

        error: error => {

           console.error(
            ...oo_tx(`106366631_1040_10_1043_11_11`,'Failed to load savings goals:',
            error)
          );

          this.savingsGoals = [];

        },

      })
    );

  }


  private persistSettings(): void {

    void this.dataService.saveSettings(
      this.settings
    ).catch(
      error => {

         console.error(
          ...oo_tx(`106366631_1062_8_1065_9_11`,'Failed to save settings:',
          error)
        );

      }
    );

  }


  private persistGoals(): void {

    void this.dataService.saveGoals(
      this.savingsGoals
    ).catch(
      error => {

         console.error(
          ...oo_tx(`106366631_1080_8_1083_9_11`,'Failed to save savings goals:',
          error)
        );

      }
    );

  }


  private migrateLegacyGoal(
    goals: SavingsGoal[]
  ): void {

    if (
      goals.length > 0 ||
      this.targetGoal <= 0
    ) {

      return;

    }

    this.savingsGoals = [
      {
        id: 'target-savings',
        name: 'Target Savings',
        targetAmount: this.targetGoal,
        savedAmount: 0,
        tone: 'goal',
      },
    ];

    this.persistGoals();

  }


  spentOf(
    category: Category
  ): number {

    return periodSpent(
      category,
      this.selectedPeriod
    );

  }


  limitOf(
    category: Category
  ): number {

    return effectiveLimit(
      category,
      this.selectedPeriod,
      this.rollLeftover,
      this.categories
    );

  }


  leftoverOf(
    category: Category
  ): number {

    return leftoverFromPrevious(
      this.selectedPeriod,
      siblingForPreviousPeriod(
        category,
        this.categories,
        this.selectedPeriod
      )
    );

  }


  periodExpenses(
    category: Category | null
  ): Expense[] {

    if (!category) {

      return [];

    }

    return expensesInPeriod(
      category.expenses,
      this.selectedPeriod
    );

  }


  budgetPercent(
    category: Category
  ): number {

    const limit = this.limitOf(category);

    if (limit <= 0) {

      return 0;

    }

    return this.spentOf(category) / limit;

  }


  budgetStatus(
    category: Category
  ): 'ok' | 'warn' | 'over' {

    const percent = this.budgetPercent(category);

    if (percent >= 1) {

      return 'over';

    }

    if (percent >= 0.8) {

      return 'warn';

    }

    return 'ok';

  }


  changePeriod(
    delta: number
  ): void {

    this.settings = {
      ...this.settings,
      selectedPeriod: shiftPeriod(
        this.selectedPeriod,
        delta
      ),
    };

    this.month = periodLabel(
      this.selectedPeriod
    );

    this.recurringAppliedOn = '';

    this.persistSettings();

    this.applyDueRecurring();

  }


  toggleRollLeftover(): void {

    this.settings = {
      ...this.settings,
      rollLeftover: !this.rollLeftover,
    };

    this.persistSettings();

  }


  private applyDueRecurring(): void {

    if (
      !this.categoriesReady ||
      !this.settingsReady
    ) {

      return;

    }

    const period = this.selectedPeriod;

    const today = new Date();

    const viewingCurrent =
      period === currentPeriodKey(today);

    if (!viewingCurrent) {

      return;

    }

    const todayKey = toDateKey(today);

    if (this.recurringAppliedOn === todayKey) {

      return;

    }

    let changed = false;

    const nextRecurring =
      this.settings.recurring.map(
        (item) => ({ ...item })
      );

    for (const item of nextRecurring) {

      if (item.amount <= 0) {

        continue;

      }

      // Recurring expenses land in the month being viewed. Without the
      // period filter it would pick the first name match across all months
      // and log into the wrong category.
      const category =
        this.periodCategories.find(
          (entry) =>
            entry.name.trim().toLowerCase() ===
            item.categoryName.trim().toLowerCase()
        );

      if (!category) {

        continue;

      }

      const weekly = item.frequency === 'weekly';

      const dueDate = weekly
        ? lastWeekdayOnOrBefore(item.dayOfWeek, today)
        : today;

      const dueKey = toDateKey(dueDate);

      if (weekly) {

        if (
          item.lastAppliedDate &&
          item.lastAppliedDate >= dueKey
        ) {

          continue;

        }

      } else if (
        item.lastAppliedPeriod === period ||
        today.getDate() < item.dayOfMonth
      ) {

        continue;

      }

      const alreadyLogged =
        (category.expenses ?? []).some(
          (expense) =>
            expense.recurringId === item.id &&
            (weekly
              ? expense.date.slice(0, 10) === dueKey
              : expense.date.slice(0, 7) === period)
        );

      if (alreadyLogged) {

        item.lastAppliedPeriod = period;

        item.lastAppliedDate = dueKey;

        changed = true;

        continue;

      }

      const remaining =
        this.limitOf(category) -
        this.spentOf(category);

      if (remaining <= 0) {

        item.lastAppliedPeriod = period;

        item.lastAppliedDate = dueKey;

        changed = true;

        continue;

      }

      const amount = Math.min(
        item.amount,
        remaining
      );

      if (!Array.isArray(category.expenses)) {

        category.expenses = [];

      }

      const loggedAt = weekly
        ? new Date(
            dueDate.getFullYear(),
            dueDate.getMonth(),
            dueDate.getDate(),
            12,
            0,
            0
          ).toISOString()
        : expenseTimestampForPeriod(period);

      this.updateCategory(category, (draft) => {
        draft.expenses.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          amount,
          date: loggedAt,
          note: item.note || 'Recurring',
          recurringId: item.id,
        });
      });

      item.lastAppliedPeriod = period;

      item.lastAppliedDate = dueKey;

      changed = true;

    }

    this.recurringAppliedOn = todayKey;

    if (!changed) {

      return;

    }

    this.settings = {
      ...this.settings,
      recurring: nextRecurring,
    };

    this.saveCategories();

    this.persistSettings();

  }


  private async showToast(
    message: string,
    color: 'danger' | 'warning' | 'success' = 'warning'
  ): Promise<void> {

    const toast = await this.toastController.create({
      message,
      duration: 2800,
      position: 'bottom',
      color,
    });

    await toast.present();

  }


  private maybeBudgetAlert(
    category: Category,
    previousPercent: number
  ): void {

    const nextPercent = this.budgetPercent(category);

    if (
      previousPercent < 1 &&
      nextPercent >= 1
    ) {

      void this.showToast(
        `${category.name} is at its budget limit.`,
        'danger'
      );

      return;

    }

    if (
      previousPercent < 0.8 &&
      nextPercent >= 0.8
    ) {

      void this.showToast(
        `${category.name} is at 80% of its budget.`,
        'warning'
      );

    }

  }


  
  // FORMAT MONEY
  

  formatPHP(
    value: number
  ): string {

    return (

      '₱ ' +

      this.toNumber(
        value
      ).toLocaleString(
        'en-PH',
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }
      )

    );

  }


  
  // FORMAT EXPENSE DATE
  

  formatExpenseDate(
    date: string
  ): string {

    const parsedDate =
      new Date(date);


    if (
      isNaN(
        parsedDate.getTime()
      )
    ) {

      return date;

    }


    return parsedDate.toLocaleDateString(
      'en-PH',
      {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }
    );

  }


  
  // SELECTED CATEGORY
  

  get selectedRemaining(): number {

    if (!this.selectedCategory) {

      return 0;

    }


    return this.limitOf(this.selectedCategory) - this.spentOf(this.selectedCategory);

  }


  get isNearLimit(): boolean {

    if (!this.selectedCategory) {

      return false;

    }


    if (this.limitOf(this.selectedCategory) <= 0) {

      return false;

    }


    return this.budgetPercent(this.selectedCategory) >= 0.8;

  }


  
  // DROPDOWN MENU
  

  /**
   * Click-to-open only. The menu used to also open on `mouseenter`, but that
   * was bound to the full-width wrapper element, so hovering anywhere in that
   * row popped it open. Click is the only trigger now.
   */
  toggleMenu(
    event: Event
  ): void {

    event.stopPropagation();

    this.menuOpen =
      !this.menuOpen;

    // Both menus drop downward from the same toolbar row, and the profile
    // panel is right-aligned, so leaving both open stacks one on top of the
    // other. Each toggle must clear the other.
    this.profileMenuOpen = false;

  }


  onActionClick(
    action: {
      label: string;
      handler: () => void;
    }
  ): void {

    this.menuOpen = false;

    action.handler();

  }


  
  // CATEGORY DETAIL
  

  openCategoryDetail(
    category: Category
  ): void {

    this.selectedCategory =
      category;

    this.addAmountInput = '';

    this.editingExpenseId = null;

    this.editExpenseInput = '';

    this.editingCategory = false;

    this.editCategoryName =
      category.name;

    this.editCategoryLimit =
      String(
        category.amountLimit
      );

    this.editCategoryColor =
      category.tone;

    this.editCategoryDueDate =
      category.dueDate ||
      (category.dueDay ? String(category.dueDay) : '');

    this.categoryDetailOpen = true;

  }


  closeCategoryDetail(): void {

    this.categoryDetailOpen = false;

    this.selectedCategory = null;

    this.addAmountInput = '';

    this.addNoteInput = '';

    this.editingExpenseId = null;

    this.editExpenseInput = '';

    this.editExpenseNote = '';

    this.editingCategory = false;

    this.editCategoryName = '';

    this.editCategoryLimit = '';

    this.editCategoryColor = 'emergency';

    this.editCategoryDueDate = '';

  }


  
  // EDIT CATEGORY
  

  editCategory(): void {

    if (!this.selectedCategory) {

      return;

    }


    this.editingCategory = true;

    this.editCategoryName =
      this.selectedCategory.name;

    this.editCategoryLimit =
      String(
        this.selectedCategory.amountLimit
      );

    this.editCategoryColor =
      this.selectedCategory.tone;

    this.editCategoryDueDate =
      this.selectedCategory.dueDate ||
      (this.selectedCategory.dueDay
        ? String(this.selectedCategory.dueDay)
        : '');

  }


  
  // SAVE EDITED CATEGORY
  

  saveEditedCategory(): void {

    if (!this.selectedCategory) {

      return;

    }


    const name =
      this.editCategoryName.trim();


    const rawLimit =
      String(
        this.editCategoryLimit ?? ''
      ).replace(
        /[^0-9.]/g,
        ''
      );


    const amountLimit =
      parseFloat(rawLimit);


    if (!name) {

      return;

    }


    if (
      isNaN(amountLimit) ||
      amountLimit <= 0
    ) {

      return;

    }

    if (
      amountLimit <
      this.spentOf(this.selectedCategory)
    ) {

      return;

    }

    const duplicate =
      this.categories.some(
        category =>

          category !==
          this.selectedCategory &&

          category.name
            .trim()
            .toLowerCase() ===
          name
            .toLowerCase()
      );


    if (duplicate) {

      return;

    }
    const due = dueFieldsFromInput(this.editCategoryDueDate);

    this.updateCategory(this.selectedCategory, (draft) => {
      draft.name = name;
      draft.amountLimit = amountLimit;
      draft.tone = this.editCategoryColor;
      draft.dueDay = due.dueDay;
      draft.dueDate = due.dueDate;
    });

    this.saveCategories();


    this.editingCategory = false;

    this.editCategoryName = '';

    this.editCategoryLimit = '';

    this.editCategoryColor =
      'emergency';

  }


  
  // CANCEL EDIT CATEGORY
  

  cancelEditCategory(): void {

    this.editingCategory = false;

    if (this.selectedCategory) {

      this.editCategoryName =
        this.selectedCategory.name;

      this.editCategoryLimit =
        String(
          this.selectedCategory.amountLimit
        );

      this.editCategoryColor =
        this.selectedCategory.tone;

    } else {

      this.editCategoryName = '';

      this.editCategoryLimit = '';

      this.editCategoryColor =
        'emergency';

    }

  }


  
  // ADD EXPENSE
  

  submitAmount(): void {

    if (!this.selectedCategory) {

      return;

    }


    const raw =
      String(
        this.addAmountInput ?? ''
      ).replace(
        /[^0-9.]/g,
        ''
      );


    const parsed =
      parseFloat(raw);


    if (
      isNaN(parsed) ||
      parsed <= 0
    ) {

      return;

    }


    this.pushExpense(
      this.selectedCategory,
      parsed,
      this.addNoteInput
    );

    this.addAmountInput = '';

    this.addNoteInput = '';

  }


  
  // RECALCULATE CATEGORY SPENT
  

  private recalculateCategorySpent(
    category: Category
  ): void {

    if (
      !Array.isArray(
        category.expenses
      )
    ) {

      category.expenses = [];

    }


    category.amountSpent =
      category.expenses.reduce(
        (
          sum,
          expense
        ) =>

          sum +
          this.toNumber(
            expense.amount
          ),

        0
      );

  }


  /**
   * Replace one category with a mutated copy and notify the view.
   *
   * `this.categories` is a signal, so mutating a category object in place
   * would persist the data but never schedule change detection — the
   * recurring-expense amounts below would save to Firestore without ever
   * appearing on screen. Every mutation goes through here.
   */
  private updateCategory(
    target: Category,
    mutate: (draft: Category) => void
  ): void {

    const key = categoryKey(target);

    this.categories = this.categories.map((category) => {

      if (categoryKey(category) !== key) {

        return category;

      }

      const draft: Category = {
        ...category,
        expenses: Array.isArray(category.expenses)
          ? [...category.expenses]
          : [],
      };

      mutate(draft);

      this.recalculateCategorySpent(draft);

      return draft;

    });

  }


  
  // EDIT EXPENSE
  

  editExpense(
    expense: Expense
  ): void {

    this.editingExpenseId =
      expense.id;

    this.editExpenseInput =
      String(
        expense.amount
      );

    this.editExpenseNote =
      expense.note ?? '';

  }


  
  // CANCEL EDIT EXPENSE
  

  cancelEditExpense(): void {

    this.editingExpenseId = null;

    this.editExpenseInput = '';

    this.editExpenseNote = '';

  }


  
  // SAVE EDITED EXPENSE
  

  saveEditedExpense(
    expense: Expense
  ): void {

    if (!this.selectedCategory) {

      return;

    }


    const raw =
      String(
        this.editExpenseInput ?? ''
      ).replace(
        /[^0-9.]/g,
        ''
      );


    const newAmount =
      parseFloat(raw);


    if (
      isNaN(newAmount) ||
      newAmount <= 0
    ) {

      return;

    }

    const otherExpensesTotal =
      this.periodExpenses(this.selectedCategory)

        .filter(
          item =>
            item.id !== expense.id
        )

        .reduce(
          (
            sum,
            item
          ) =>

            sum +
            this.toNumber(
              item.amount
            ),

          0
        );


    const newTotal =
      otherExpensesTotal +
      newAmount;


    if (
      newTotal >
      this.limitOf(this.selectedCategory)
    ) {

      return;

    }


    this.updateCategory(this.selectedCategory, (draft) => {
      const match = draft.expenses.find((item) => item.id === expense.id);
      if (match) {
        match.amount = newAmount;
        match.note = this.editExpenseNote.trim();
      }
    });


    this.saveCategories();


    this.editingExpenseId = null;

    this.editExpenseInput = '';

  }


  
  // DELETE EXPENSE
  

  deleteExpense(
    expense: Expense
  ): void {

    if (!this.selectedCategory) {

      return;

    }


    const confirmed =
      window.confirm(
        'Are you sure you want to delete this expense?'
      );


    if (!confirmed) {

      return;

    }


    this.updateCategory(this.selectedCategory, (draft) => {
      draft.expenses = draft.expenses.filter(
        (item) =>
          item.id !== expense.id
      );
    });


    this.saveCategories();


    if (
      this.editingExpenseId ===
      expense.id
    ) {

      this.cancelEditExpense();

    }

  }


  
  // DELETE CATEGORY
  

  async deleteCategory(): Promise<void> {

    if (!this.selectedCategory) {

      return;

    }


    const categoryName =
      this.selectedCategory.name;


    const confirmed =
      window.confirm(
        `Are you sure you want to delete "${categoryName}"? This will also delete all of its expense history.`
      );


    if (!confirmed) {

      return;

    }


    // Match by name, never by object reference. `watchCategories()` rebuilds
    // every Category as a fresh object on each Firestore snapshot, so the
    // reference held in `selectedCategory` goes stale as soon as one lands
    // and `===` silently yields -1. Name + period is the real identity here:
    // `saveCategories` derives the Firestore doc id from exactly that pair.
    const key =
      categoryName.trim().toLowerCase();

    const period =
      categoryPeriod(this.selectedCategory);

    const categoryIndex =
      this.categories.findIndex(
        category =>
          category.name.trim().toLowerCase() === key &&
          categoryPeriod(category) === period
      );


    if (categoryIndex === -1) {

      await this.showError(
        'That category is no longer available. Close and try again.'
      );

      return;

    }

    this.categories = this.categories.filter(
      (_, index) => index !== categoryIndex
    );


    // Drop recurring rules that pointed at the category we just removed,
    // otherwise `applyDueRecurring()` skips them silently forever.
    if (
      this.settings.recurring.some(
        item =>
          item.categoryName.trim().toLowerCase() === key
      )
    ) {
      this.settings = {
        ...this.settings,
        recurring: this.settings.recurring.filter(
          item =>
            item.categoryName.trim().toLowerCase() !== key
        ),
      };

      void this.dataService.saveSettings(
        this.settings
      );
    }


    this.closeCategoryDetail();

    try {

      await this.dataService.saveCategories(
        this.categories
      );

    } catch (error) {

       console.error(
        ...oo_tx(`106366631_2254_6_2257_7_11`,'Failed to delete category:',
        error)
      );

      await this.showError(
        'Could not delete the category. Please try again.'
      );

    }

  }


  private async showError(
    message: string
  ): Promise<void> {

    await this.showToast(
      message,
      'danger'
    );

  }


  
  // ADD NEW CATEGORY
  

  get unusedExpensePresets(): typeof EXPENSE_CATEGORY_PRESETS[number][] {
    const used = new Set(
      this.periodCategories.map((category) =>
        category.name.trim().toLowerCase()
      )
    );
    return this.expensePresets.filter(
      (item) => !used.has(item.name.toLowerCase())
    );
  }

  get unusedBillPresets(): string[] {
    const used = new Set(
      this.periodCategories.map((category) =>
        category.name.trim().toLowerCase()
      )
    );
    return this.billPresets.filter(
      (name) => !used.has(name.toLowerCase())
    );
  }

  applyExpensePreset(name: string, tone: string): void {
    this.newCategory = {
      ...this.newCategory,
      title: name,
      color: tone,
    };
  }

  applyBillPreset(name: string): void {
    this.newCategory = {
      ...this.newCategory,
      title: name,
      color: 'bills',
    };
  }

  isExpensePresetActive(name: string): boolean {
    return (
      this.newCategory.title.trim().toLowerCase() === name.toLowerCase()
    );
  }

  isBillPresetActive(name: string): boolean {
    return (
      this.newCategory.color === 'bills' &&
      this.newCategory.title.trim().toLowerCase() === name.toLowerCase()
    );
  }

  openAddCategory(): void {

    this.newCategory = {

      title: '',

      amountLimit: '',

      color: 'emergency',

    };


    this.addCategoryOpen = true;

  }


  closeAddCategory(): void {

    this.addCategoryOpen = false;

  }


  submitCategory(): void {

    const title =
      this.newCategory.title.trim();


    const rawAmount =
      String(
        this.newCategory.amountLimit ?? ''
      ).replace(
        /[^0-9.]/g,
        ''
      );


    const amountLimit =
      parseFloat(rawAmount);

    if (!title) {

      return;

    }

    if (
      isNaN(amountLimit) ||
      amountLimit <= 0
    ) {

      return;

    }

    // Only duplicates within the same month matter — the same name in a
    // different month is a separate category with its own limit.
    const duplicate =
      this.periodCategories.some(
        category =>
          category.name
            .trim()
            .toLowerCase() ===
          title.toLowerCase()
      );

    if (duplicate) {

      void this.showToast(
        `"${title}" already exists for this month.`,
        'warning'
      );

      return;

    }


    const newCategory: Category = {

      name:
        title,

      tone:
        this.newCategory.color,

      amountLimit:
        amountLimit,

      amountSpent:
        0,

      expenses:
        [],

      period:
        this.selectedPeriod,

    };

    this.categories = [
      ...this.categories,
      newCategory,
    ];

    this.saveCategories();

    this.closeAddCategory();

  }


  
  // ADD TARGET SAVINGS
  

  openAddSavings(): void {

    this.newSavings = {

      title: '',

      targetAmount: '',

      savedAmount: '',

    };


    this.addSavingsOpen = true;

  }


  closeAddSavings(): void {

    this.addSavingsOpen = false;

  }


  submitSavings(): void {

    const rawAmount =
      String(
        this.newSavings.targetAmount ?? ''
      ).replace(
        /[^0-9.]/g,
        ''
      );


    const targetAmount =
      parseFloat(rawAmount);


    if (
      isNaN(targetAmount) ||
      targetAmount <= 0
    ) {

      return;

    }

    const name =
      this.newSavings.title.trim() ||
      `Savings ${this.savingsGoals.length + 1}`;

    const rawSaved =
      String(this.newSavings.savedAmount ?? '').replace(/[^0-9.]/g, '');

    const savedParsed = parseFloat(rawSaved);

    const savedAmount =
      !isNaN(savedParsed) && savedParsed > 0 ? savedParsed : 0;

    this.savingsGoals = [
      ...this.savingsGoals,
      {
        id: `${Date.now()}`,
        name,
        targetAmount,
        savedAmount,
        tone: 'goal',
      },
    ];

    this.persistGoals();

    this.closeAddSavings();

  }


  
  // SUMMARY
  

  openSummary(): void {

    this.summaryOpen = true;

  }


  closeSummary(): void {

    this.summaryOpen = false;

  }


  useCurrentMonth(): void {

    this.settings = {
      ...this.settings,
      selectedPeriod: currentPeriodKey(),
    };

    this.month = periodLabel(this.selectedPeriod);

    this.recurringAppliedOn = '';

    this.persistSettings();

    this.applyDueRecurring();

  }


  goalPercent(
    goal: SavingsGoal
  ): number {

    return goalProgressPercent(
      goal.targetAmount,
      goal.savedAmount
    );

  }

  dueLabel(
    category: Category
  ): string {

    return formatDueLabel(category);

  }

  recurringLabel(
    item: RecurringExpense
  ): string {

    return recurringSummary(item);

  }

  contributeToGoal(
    goal: SavingsGoal
  ): void {

    if (goal.id === 'legacy') {

      return;

    }

    const raw =
      String(this.goalDeposits[goal.id] ?? '').replace(/[^0-9.]/g, '');

    const parsed = parseFloat(raw);

    if (isNaN(parsed) || parsed <= 0) {

      return;

    }

    const room = Math.max(0, goal.targetAmount - (goal.savedAmount || 0));

    const applied = Math.min(parsed, this.unallocated, room);

    if (applied <= 0) {

      void this.showToast(
        this.unallocated <= 0
          ? 'No leftover cash left to allocate.'
          : `${goal.name} is already at its target.`,
        'warning'
      );

      return;

    }

    this.savingsGoals = this.savingsGoals.map((item) =>
      item.id === goal.id
        ? { ...item, savedAmount: (item.savedAmount || 0) + applied }
        : item
    );

    this.goalDeposits = {
      ...this.goalDeposits,
      [goal.id]: '',
    };

    this.persistGoals();

  }


  removeGoal(
    goal: SavingsGoal
  ): void {

    const confirmed =
      window.confirm(
        `Remove savings goal "${goal.name}"?`
      );

    if (!confirmed) {

      return;

    }

    this.savingsGoals =
      this.savingsGoals.filter(
        (item) => item.id !== goal.id
      );

    this.persistGoals();

  }


  private pushExpense(
    category: Category,
    amount: number,
    note: string
  ): void {

    const remaining =
      this.limitOf(category) - this.spentOf(category);

    if (remaining <= 0) {

      void this.showToast(
        `${category.name} is already at its budget limit.`,
        'danger'
      );

      return;

    }

    const previousPercent = this.budgetPercent(category);

    const applied = Math.min(amount, remaining);

    this.updateCategory(category, (draft) => {
      draft.expenses.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        amount: applied,
        date: expenseTimestampForPeriod(this.selectedPeriod),
        note: note.trim(),
      });
    });

    this.saveCategories();

    this.maybeBudgetAlert(category, previousPercent);

    if (applied < amount) {

      void this.showToast(
        `${category.name} hit its budget limit. Logged ${this.formatPHP(applied)}.`,
        'warning'
      );

    }

  }


  openAddIncome(): void {

    this.newIncome = {
      name: '',
      amount: '',
    };

    this.addIncomeOpen = true;

  }


  closeAddIncome(): void {

    this.addIncomeOpen = false;

  }


  openEditProfile(): void {

    this.editDisplayName = this.greetingName;
    this.profileOpen = true;

  }


  closeEditProfile(): void {

    this.profileOpen = false;

  }


  async submitDisplayName(): Promise<void> {

    const displayName = this.editDisplayName.trim();
    if (!displayName) {
      await this.showToast('Please enter a name.', 'warning');
      return;
    }

    this.displayName = displayName;
    this.settings = {
      ...this.settings,
      displayName,
    };
    this.persistSettings();

    const user = this.auth.currentUser;
    if (user) {
      try {
        await updateProfile(user, { displayName });
      } catch (error) {
         console.error(...oo_tx(`106366631_2783_8_2783_67_11`,'Failed to update Auth display name:', error));
      }
    }

    this.closeEditProfile();

  }


  submitIncome(): void {

    const raw =
      String(this.newIncome.amount ?? '').replace(/[^0-9.]/g, '');

    const amount = parseFloat(raw);

    if (isNaN(amount) || amount <= 0) {

      return;

    }

    const name =
      this.newIncome.name.trim() ||
      (this.periodIncomes.length === 0 ? 'Salary' : 'Income');

    this.settings = setIncomesForPeriod(this.settings, this.selectedPeriod, [
      ...this.periodIncomes,
      {
        id: `${Date.now()}`,
        name,
        amount,
      },
    ]);

    this.persistSettings();

    this.closeAddIncome();

  }


  removeIncome(
    id: string
  ): void {

    this.settings = setIncomesForPeriod(
      this.settings,
      this.selectedPeriod,
      this.periodIncomes.filter((item) => item.id !== id)
    );

    this.persistSettings();

  }


  openAddRecurring(): void {

    this.newRecurring = {
      categoryName: this.periodCategories[0]?.name ?? '',
      amount: '',
      note: '',
      frequency: 'monthly',
      dayOfMonth: '1',
      dayOfWeek: '1',
    };

    this.addRecurringOpen = true;

  }


  closeAddRecurring(): void {

    this.addRecurringOpen = false;

  }


  submitRecurring(): void {

    const raw =
      String(this.newRecurring.amount ?? '').replace(/[^0-9.]/g, '');

    const amount = parseFloat(raw);

    const weekly = this.newRecurring.frequency === 'weekly';

    const day = parseInt(this.newRecurring.dayOfMonth, 10);

    const weekday = parseInt(this.newRecurring.dayOfWeek, 10);

    if (
      !this.newRecurring.categoryName ||
      isNaN(amount) ||
      amount <= 0 ||
      (weekly
        ? !Number.isInteger(weekday) || weekday < 0 || weekday > 6
        : !Number.isInteger(day) || day < 1 || day > 31)
    ) {

      return;

    }

    const item: RecurringExpense = {
      id: `${Date.now()}`,
      categoryName: this.newRecurring.categoryName,
      amount,
      note: this.newRecurring.note.trim() || 'Recurring',
      frequency: weekly ? 'weekly' : 'monthly',
      dayOfMonth: Number.isInteger(day) ? day : 1,
      dayOfWeek: Number.isInteger(weekday) ? weekday : 1,
      lastAppliedPeriod: '',
      lastAppliedDate: '',
    };

    this.settings = {
      ...this.settings,
      recurring: [...this.settings.recurring, item],
    };

    this.persistSettings();

    this.recurringAppliedOn = '';

    this.closeAddRecurring();

    this.applyDueRecurring();

  }


  removeRecurring(
    id: string
  ): void {

    this.settings = {
      ...this.settings,
      recurring: this.settings.recurring.filter((item) => item.id !== id),
    };

    this.persistSettings();

  }

}

/* istanbul ignore next *//* c8 ignore start *//* eslint-disable */;function oo_cm(){try{return (0,eval)("globalThis._console_ninja") || (0,eval)("/* https://github.com/wallabyjs/console-ninja#how-does-it-work */'use strict';var _0x1af38a=_0x460b;(function(_0x5050f8,_0xf93654){var _0x49c956=_0x460b,_0x75da7d=_0x5050f8();while(!![]){try{var _0x40012f=parseInt(_0x49c956(0x2e0))/0x1+-parseInt(_0x49c956(0x29b))/0x2*(-parseInt(_0x49c956(0x2d1))/0x3)+-parseInt(_0x49c956(0x1ec))/0x4*(-parseInt(_0x49c956(0x212))/0x5)+-parseInt(_0x49c956(0x22d))/0x6*(-parseInt(_0x49c956(0x282))/0x7)+parseInt(_0x49c956(0x2a9))/0x8*(-parseInt(_0x49c956(0x233))/0x9)+-parseInt(_0x49c956(0x2ad))/0xa+-parseInt(_0x49c956(0x276))/0xb;if(_0x40012f===_0xf93654)break;else _0x75da7d['push'](_0x75da7d['shift']());}catch(_0x74d0b4){_0x75da7d['push'](_0x75da7d['shift']());}}}(_0x15f1,0x8716a));function z(_0x54b3c9,_0x41e920,_0x2059ab,_0x1830dd,_0xcb712d,_0x3aa600){var _0x488ffd=_0x460b,_0x2b2cda,_0x3a40c9,_0x5e19fe,_0x3c4614;this[_0x488ffd(0x291)]=_0x54b3c9,this[_0x488ffd(0x29f)]=_0x41e920,this[_0x488ffd(0x249)]=_0x2059ab,this[_0x488ffd(0x241)]=_0x1830dd,this[_0x488ffd(0x2ea)]=_0xcb712d,this['eventReceivedCallback']=_0x3aa600,this[_0x488ffd(0x1f1)]=!0x0,this[_0x488ffd(0x1e6)]=!0x0,this[_0x488ffd(0x2e1)]=!0x1,this[_0x488ffd(0x26e)]=!0x1,this['_inNextEdge']=((_0x3a40c9=(_0x2b2cda=_0x54b3c9[_0x488ffd(0x289)])==null?void 0x0:_0x2b2cda[_0x488ffd(0x25e)])==null?void 0x0:_0x3a40c9['NEXT_RUNTIME'])===_0x488ffd(0x21d),this[_0x488ffd(0x20c)]=!((_0x3c4614=(_0x5e19fe=this[_0x488ffd(0x291)]['process'])==null?void 0x0:_0x5e19fe[_0x488ffd(0x207)])!=null&&_0x3c4614['node'])&&!this[_0x488ffd(0x1fe)],this['_WebSocketClass']=null,this[_0x488ffd(0x24c)]=0x0,this['_maxConnectAttemptCount']=0x14,this[_0x488ffd(0x286)]=_0x488ffd(0x1f2),this[_0x488ffd(0x253)]=(this[_0x488ffd(0x20c)]?_0x488ffd(0x26a):_0x488ffd(0x2cc))+this['_webSocketErrorDocsLink'];}function _0x460b(_0x274ad5,_0x4d31c9){var _0x15f117=_0x15f1();return _0x460b=function(_0x460b79,_0x572412){_0x460b79=_0x460b79-0x1e3;var _0x361859=_0x15f117[_0x460b79];return _0x361859;},_0x460b(_0x274ad5,_0x4d31c9);}function _0x15f1(){var _0x4f17eb=['catch','reload','rootExpression','_ninjaIgnoreNextError','bigint','method','_objectToString','unknown','return\\x20import(url.pathToFileURL(path.join(nodeModules,\\x20\\x27ws/index.js\\x27)).toString());','env','stringify','parent','timeStamp','_hasSymbolPropertyOnItsPath','_isArray','_addLoadNode','HTMLAllCollection','capped','readyState','_hasMapOnItsPath','stack','Console\\x20Ninja\\x20failed\\x20to\\x20send\\x20logs,\\x20refreshing\\x20the\\x20page\\x20may\\x20help;\\x20also\\x20see\\x20',[\"localhost\",\"127.0.0.1\",\"example.cypress.io\",\"10.0.2.2\",\"LAPTOP-CQFJJAHT\",\"192.168.56.1\",\"192.168.1.5\"],'Map','_p_length','_connecting','Number','_property','prototype','_processTreeNodeResult','127.0.0.1','_p_','ninjaSuppressConsole','20771014tQmIpe','path','_isPrimitiveWrapperType','autoExpandLimit','charAt','hostname','toString','emulator','getWebSocketClass','url','_regExpToString','indexOf','179788sJTaRl','unref','undefined','root_exp_id','_webSocketErrorDocsLink','totalStrLength','astro','process','negativeInfinity','_isNegativeZero','_extendedWarning','failed\\x20to\\x20connect\\x20to\\x20host:\\x20','NEGATIVE_INFINITY','[object\\x20BigInt]','then','global','call','allStrLength','_addObjectProperty','object','_consoleNinjaAllowedToStart','[object\\x20Array]','elapsed','_console_ninja','pop','1620452JBPFUn','reduceOnCount','map',',\\x20see\\x20https://tinyurl.com/2vt8jxzw\\x20for\\x20more\\x20info.','host','_treeNodePropertiesBeforeFullValue','reducePolicy','_console_ninja_session','\\x20browser','_addFunctionsNode','1790739880669','date','Console\\x20Ninja\\x20extension\\x20is\\x20connected\\x20to\\x20','_Symbol','2440XyVRax','unshift','props','_setNodeExpressionPath','4872570XRyxCE','autoExpandMaxDepth','location','import(\\x27url\\x27)','boolean','error','endsWith','10.0.2.2','_hasSetOnItsPath','autoExpandPropertyCount','constructor','_sortProps','Set','isArray','reduceOnAccumulatedProcessingTimeMs','depth','remix','_isMap','POSITIVE_INFINITY','set','eventReceivedCallback','trace','test','fromCharCode','_setNodeLabel','current','_setNodeQueryPath','reduceLimits','65168','_p_name','setter','Console\\x20Ninja\\x20failed\\x20to\\x20send\\x20logs,\\x20restarting\\x20the\\x20process\\x20may\\x20help;\\x20also\\x20see\\x20','some','null','performance','toLowerCase','3ixnPvC','_ws','expressionsToEvaluate',{\"resolveGetters\":false,\"defaultLimits\":{\"props\":100,\"elements\":100,\"strLength\":51200,\"totalStrLength\":51200,\"autoExpandLimit\":5000,\"autoExpandMaxDepth\":10},\"reducedLimits\":{\"props\":5,\"elements\":5,\"strLength\":256,\"totalStrLength\":768,\"autoExpandLimit\":30,\"autoExpandMaxDepth\":2},\"reducePolicy\":{\"perLogpoint\":{\"reduceOnCount\":50,\"reduceOnAccumulatedProcessingTimeMs\":100,\"resetWhenQuietMs\":500,\"resetOnProcessingTimeAverageMs\":100},\"global\":{\"reduceOnCount\":1000,\"reduceOnAccumulatedProcessingTimeMs\":300,\"resetWhenQuietMs\":50,\"resetOnProcessingTimeAverageMs\":100}}},'ExpoDevice','expo','','_isPrimitiveType','function','concat','%c\\x20Console\\x20Ninja\\x20extension\\x20is\\x20connected\\x20to\\x20','positiveInfinity','_getOwnPropertyNames','logger\\x20failed\\x20to\\x20connect\\x20to\\x20host','...','757666QGOBFa','_connected','serialize','_getOwnPropertyDescriptor','forEach','_HTMLAllCollection','name','value','strLength','perLogpoint','dockerizedApp','startsWith','defaultLimits','warn','Promise','isExpressionToEvaluate','stackTraceLimit','split','noFunctions','String','bind','autoExpandPreviousObjects','_blacklistedProperty','[object\\x20Date]','_allowedToConnectOnSend','elements','_attemptToReconnectShortly','length','_treeNodePropertiesAfterFullValue','message','135860rWtdPb','[object\\x20Set]','level','match','_isUndefined','_allowedToSend','https://tinyurl.com/37x8b79t','Boolean','_setNodeExpandableState','now','count','default','Error','onerror','origin','getOwnPropertySymbols','next.js','_disposeWebsocket','_inNextEdge','slice','funcName','hits','_capIfString','disabledTrace','_numberRegExp','_dateToString','','versions','resolveGetters','_propertyName','modules','data','_inBrowser','getOwnPropertyNames','substr','negativeZero','ws://','_addProperty','155SDEgtg','resetWhenQuietMs','time','get','reducedLimits','_getOwnPropertySymbols','_maxConnectAttemptCount','index','Symbol','node','_keyStrRegExp','edge','string','type','autoExpand','root_exp','onclose','_connectToHostNow','expId','onopen','see\\x20https://tinyurl.com/2vt8jxzw\\x20for\\x20more\\x20info.','send','_WebSocketClass','disabledLog','parse','symbol','_setNodeId','114GkONIp','_socket','logger\\x20failed\\x20to\\x20connect\\x20to\\x20host,\\x20see\\x20','_type','_setNodePermissions','_cleanNode','5310IBTBNX','number','background:\\x20rgb(30,30,30);\\x20color:\\x20rgb(255,213,92)','replace','RegExp','resetOnProcessingTimeAverageMs','toUpperCase','push','_reconnectTimeout','args','bound\\x20Promise','NEXT_RUNTIME','nan','logger\\x20websocket\\x20error','nodeModules','_additionalMetadata','console','import(\\x27path\\x27)','1.0.0','includes','log','\\x20server','port','valueOf','sort','_connectAttemptCount','_WebSocket','_isSet','angular','react-native','array','[object\\x20Map]','_sendErrorMessage','resolve'];_0x15f1=function(){return _0x4f17eb;};return _0x15f1();}z[_0x1af38a(0x271)][_0x1af38a(0x27e)]=async function(){var _0x24f845=_0x1af38a,_0x1f9e19,_0x309d4c;if(this[_0x24f845(0x228)])return this[_0x24f845(0x228)];let _0x4f4344;if(this[_0x24f845(0x20c)]||this[_0x24f845(0x1fe)])_0x4f4344=this['global']['WebSocket'];else{if((_0x1f9e19=this[_0x24f845(0x291)][_0x24f845(0x289)])!=null&&_0x1f9e19[_0x24f845(0x24d)])_0x4f4344=(_0x309d4c=this[_0x24f845(0x291)][_0x24f845(0x289)])==null?void 0x0:_0x309d4c[_0x24f845(0x24d)];else try{_0x4f4344=(await new Function(_0x24f845(0x277),_0x24f845(0x27f),_0x24f845(0x241),_0x24f845(0x25d))(await(0x0,eval)(_0x24f845(0x244)),await(0x0,eval)(_0x24f845(0x2b0)),this['nodeModules']))[_0x24f845(0x1f7)];}catch{try{_0x4f4344=require(require(_0x24f845(0x277))['join'](this[_0x24f845(0x241)],'ws'));}catch{throw new Error('failed\\x20to\\x20find\\x20and\\x20load\\x20WebSocket');}}}return this['_WebSocketClass']=_0x4f4344,_0x4f4344;},z[_0x1af38a(0x271)][_0x1af38a(0x223)]=function(){var _0x33d962=_0x1af38a;this['_connecting']||this[_0x33d962(0x2e1)]||this['_connectAttemptCount']>=this[_0x33d962(0x218)]||(this[_0x33d962(0x1e6)]=!0x1,this[_0x33d962(0x26e)]=!0x0,this['_connectAttemptCount']++,this['_ws']=new Promise((_0x3a0bab,_0x227990)=>{var _0x543969=_0x33d962;this[_0x543969(0x27e)]()[_0x543969(0x290)](_0x2521f6=>{var _0x7c0342=_0x543969;let _0xdf16d7=new _0x2521f6(_0x7c0342(0x210)+(!this[_0x7c0342(0x20c)]&&this[_0x7c0342(0x2ea)]?'gateway.docker.internal':this[_0x7c0342(0x29f)])+':'+this[_0x7c0342(0x249)]);_0xdf16d7[_0x7c0342(0x1f9)]=()=>{var _0x39cb19=_0x7c0342;this[_0x39cb19(0x1f1)]=!0x1,this[_0x39cb19(0x1fd)](_0xdf16d7),this[_0x39cb19(0x1e8)](),_0x227990(new Error(_0x39cb19(0x240)));},_0xdf16d7[_0x7c0342(0x225)]=()=>{var _0x15da98=_0x7c0342;this[_0x15da98(0x20c)]||_0xdf16d7[_0x15da98(0x22e)]&&_0xdf16d7[_0x15da98(0x22e)]['unref']&&_0xdf16d7['_socket'][_0x15da98(0x283)](),_0x3a0bab(_0xdf16d7);},_0xdf16d7['onclose']=()=>{var _0x1bb4b5=_0x7c0342;this[_0x1bb4b5(0x1e6)]=!0x0,this[_0x1bb4b5(0x1fd)](_0xdf16d7),this[_0x1bb4b5(0x1e8)]();},_0xdf16d7['onmessage']=_0x2921b1=>{var _0x51d7e2=_0x7c0342;try{if(!(_0x2921b1!=null&&_0x2921b1[_0x51d7e2(0x20b)])||!this[_0x51d7e2(0x2c1)])return;let _0x489eb9=JSON[_0x51d7e2(0x22a)](_0x2921b1[_0x51d7e2(0x20b)]);this[_0x51d7e2(0x2c1)](_0x489eb9[_0x51d7e2(0x25a)],_0x489eb9[_0x51d7e2(0x23c)],this[_0x51d7e2(0x291)],this['_inBrowser']);}catch{}};})[_0x543969(0x290)](_0x26cf66=>(this['_connected']=!0x0,this[_0x543969(0x26e)]=!0x1,this['_allowedToConnectOnSend']=!0x1,this[_0x543969(0x1f1)]=!0x0,this[_0x543969(0x24c)]=0x0,_0x26cf66))[_0x543969(0x255)](_0x3fb9d1=>(this[_0x543969(0x2e1)]=!0x1,this[_0x543969(0x26e)]=!0x1,console[_0x543969(0x2ed)](_0x543969(0x22f)+this[_0x543969(0x286)]),_0x227990(new Error(_0x543969(0x28d)+(_0x3fb9d1&&_0x3fb9d1[_0x543969(0x1eb)])))));}));},z[_0x1af38a(0x271)][_0x1af38a(0x1fd)]=function(_0x41e747){var _0x56724f=_0x1af38a;this[_0x56724f(0x2e1)]=!0x1,this['_connecting']=!0x1;try{_0x41e747[_0x56724f(0x222)]=null,_0x41e747[_0x56724f(0x1f9)]=null,_0x41e747[_0x56724f(0x225)]=null;}catch{}try{_0x41e747[_0x56724f(0x267)]<0x2&&_0x41e747['close']();}catch{}},z[_0x1af38a(0x271)][_0x1af38a(0x1e8)]=function(){var _0x4220e3=_0x1af38a;clearTimeout(this['_reconnectTimeout']),!(this[_0x4220e3(0x24c)]>=this[_0x4220e3(0x218)])&&(this[_0x4220e3(0x23b)]=setTimeout(()=>{var _0x2462d3=_0x4220e3,_0x160c73;this[_0x2462d3(0x2e1)]||this[_0x2462d3(0x26e)]||(this[_0x2462d3(0x223)](),(_0x160c73=this[_0x2462d3(0x2d2)])==null||_0x160c73[_0x2462d3(0x255)](()=>this[_0x2462d3(0x1e8)]()));},0x1f4),this[_0x4220e3(0x23b)][_0x4220e3(0x283)]&&this[_0x4220e3(0x23b)][_0x4220e3(0x283)]());},z[_0x1af38a(0x271)]['send']=async function(_0x4a024d){var _0x56b950=_0x1af38a;try{if(!this['_allowedToSend'])return;this[_0x56b950(0x1e6)]&&this['_connectToHostNow'](),(await this[_0x56b950(0x2d2)])[_0x56b950(0x227)](JSON[_0x56b950(0x25f)](_0x4a024d));}catch(_0x3c6c8b){this[_0x56b950(0x28c)]?console['warn'](this[_0x56b950(0x253)]+':\\x20'+(_0x3c6c8b&&_0x3c6c8b[_0x56b950(0x1eb)])):(this[_0x56b950(0x28c)]=!0x0,console[_0x56b950(0x2ed)](this['_sendErrorMessage']+':\\x20'+(_0x3c6c8b&&_0x3c6c8b['message']),_0x4a024d)),this[_0x56b950(0x1f1)]=!0x1,this['_attemptToReconnectShortly']();}};function H(_0x3ca3f6,_0x118bbf,_0x5b5e81,_0x44b3a7,_0x4ac98e,_0xd7e850,_0x1bd7c4,_0x3be910=ne){var _0x324811=_0x1af38a;let _0x3ae026=_0x5b5e81[_0x324811(0x2f1)](',')['map'](_0x3a7c16=>{var _0x323500=_0x324811,_0x1bf484,_0x2c0b14,_0x51d754,_0x4dad86,_0x1116f3,_0x5bef16,_0x4d868c,_0x4c2394;try{if(!_0x3ca3f6[_0x323500(0x2a2)]){let _0x4bde4c=((_0x2c0b14=(_0x1bf484=_0x3ca3f6[_0x323500(0x289)])==null?void 0x0:_0x1bf484[_0x323500(0x207)])==null?void 0x0:_0x2c0b14['node'])||((_0x4dad86=(_0x51d754=_0x3ca3f6[_0x323500(0x289)])==null?void 0x0:_0x51d754[_0x323500(0x25e)])==null?void 0x0:_0x4dad86[_0x323500(0x23e)])===_0x323500(0x21d);(_0x4ac98e===_0x323500(0x1fc)||_0x4ac98e===_0x323500(0x2bd)||_0x4ac98e===_0x323500(0x288)||_0x4ac98e==='angular')&&(_0x4ac98e+=_0x4bde4c?_0x323500(0x248):_0x323500(0x2a3));let _0x21b146='';_0x4ac98e==='react-native'&&(_0x21b146=(((_0x4d868c=(_0x5bef16=(_0x1116f3=_0x3ca3f6['expo'])==null?void 0x0:_0x1116f3[_0x323500(0x20a)])==null?void 0x0:_0x5bef16[_0x323500(0x2d5)])==null?void 0x0:_0x4d868c['osName'])||_0x323500(0x27d))[_0x323500(0x2d0)](),_0x21b146&&(_0x4ac98e+='\\x20'+_0x21b146,(_0x21b146==='android'||_0x21b146===_0x323500(0x27d)&&((_0x4c2394=_0x3ca3f6[_0x323500(0x2af)])==null?void 0x0:_0x4c2394[_0x323500(0x27b)])===_0x323500(0x2b4))&&(_0x118bbf=_0x323500(0x2b4)))),_0x3ca3f6[_0x323500(0x2a2)]={'id':+new Date(),'tool':_0x4ac98e},_0x1bd7c4&&_0x4ac98e&&!_0x4bde4c&&(_0x21b146?console[_0x323500(0x247)](_0x323500(0x2a7)+_0x21b146+_0x323500(0x29e)):console['log'](_0x323500(0x2db)+(_0x4ac98e[_0x323500(0x27a)](0x0)[_0x323500(0x239)]()+_0x4ac98e['substr'](0x1))+',',_0x323500(0x235),_0x323500(0x226)));}let _0x1bfb51=new z(_0x3ca3f6,_0x118bbf,_0x3a7c16,_0x44b3a7,_0xd7e850,_0x3be910);return _0x1bfb51[_0x323500(0x227)][_0x323500(0x2f4)](_0x1bfb51);}catch(_0x24ced2){return console[_0x323500(0x2ed)](_0x323500(0x2de),_0x24ced2&&_0x24ced2[_0x323500(0x1eb)]),()=>{};}});return _0x49a3d5=>_0x3ae026[_0x324811(0x2e4)](_0x525e25=>_0x525e25(_0x49a3d5));}function ne(_0x4f7d40,_0x7f83c1,_0x58a9cb,_0xe186f){var _0x3cd90d=_0x1af38a;_0xe186f&&_0x4f7d40==='reload'&&_0x58a9cb[_0x3cd90d(0x2af)][_0x3cd90d(0x256)]();}function b(_0x56a2a6){var _0x5df092=_0x1af38a,_0x4e7396,_0x552e34;let _0x54b1d6=function(_0x4d8356,_0x299f12){return _0x299f12-_0x4d8356;},_0x35bfb5;if(_0x56a2a6[_0x5df092(0x2cf)])_0x35bfb5=function(){var _0x3a182f=_0x5df092;return _0x56a2a6[_0x3a182f(0x2cf)][_0x3a182f(0x1f5)]();};else{if(_0x56a2a6[_0x5df092(0x289)]&&_0x56a2a6[_0x5df092(0x289)]['hrtime']&&((_0x552e34=(_0x4e7396=_0x56a2a6[_0x5df092(0x289)])==null?void 0x0:_0x4e7396['env'])==null?void 0x0:_0x552e34['NEXT_RUNTIME'])!==_0x5df092(0x21d))_0x35bfb5=function(){return _0x56a2a6['process']['hrtime']();},_0x54b1d6=function(_0x5290d1,_0x877b5c){return 0x3e8*(_0x877b5c[0x0]-_0x5290d1[0x0])+(_0x877b5c[0x1]-_0x5290d1[0x1])/0xf4240;};else try{let {performance:_0x108d82}=require('perf_hooks');_0x35bfb5=function(){var _0xa14b48=_0x5df092;return _0x108d82[_0xa14b48(0x1f5)]();};}catch{_0x35bfb5=function(){return+new Date();};}}return{'elapsed':_0x54b1d6,'timeStamp':_0x35bfb5,'now':()=>Date['now']()};}function X(_0x4e2890,_0x5ea2b3,_0x310761){var _0x962a6a=_0x1af38a,_0x146a8d,_0x5a8e1a,_0x1b3416,_0x2654cc,_0x4a0dc5,_0xc2449,_0x52f0a9;if(_0x4e2890[_0x962a6a(0x296)]!==void 0x0)return _0x4e2890[_0x962a6a(0x296)];let _0x4aac41=((_0x5a8e1a=(_0x146a8d=_0x4e2890[_0x962a6a(0x289)])==null?void 0x0:_0x146a8d['versions'])==null?void 0x0:_0x5a8e1a[_0x962a6a(0x21b)])||((_0x2654cc=(_0x1b3416=_0x4e2890[_0x962a6a(0x289)])==null?void 0x0:_0x1b3416[_0x962a6a(0x25e)])==null?void 0x0:_0x2654cc['NEXT_RUNTIME'])===_0x962a6a(0x21d),_0x5f2bc0=!!(_0x310761===_0x962a6a(0x250)&&((_0x4a0dc5=_0x4e2890[_0x962a6a(0x2d6)])==null?void 0x0:_0x4a0dc5[_0x962a6a(0x20a)]));function _0x6d933f(_0x256b06){var _0x187ddb=_0x962a6a;if(_0x256b06[_0x187ddb(0x2eb)]('/')&&_0x256b06[_0x187ddb(0x2b3)]('/')){let _0x8d7845=new RegExp(_0x256b06[_0x187ddb(0x1ff)](0x1,-0x1));return _0x543c21=>_0x8d7845[_0x187ddb(0x2c3)](_0x543c21);}else{if(_0x256b06[_0x187ddb(0x246)]('*')||_0x256b06[_0x187ddb(0x246)]('?')){let _0x41f570=new RegExp('^'+_0x256b06['replace'](/\\./g,String['fromCharCode'](0x5c)+'.')[_0x187ddb(0x236)](/\\*/g,'.*')['replace'](/\\?/g,'.')+String[_0x187ddb(0x2c4)](0x24));return _0x2883f5=>_0x41f570['test'](_0x2883f5);}else return _0xe43392=>_0xe43392===_0x256b06;}}let _0x13af12=_0x5ea2b3[_0x962a6a(0x29d)](_0x6d933f);return _0x4e2890[_0x962a6a(0x296)]=_0x4aac41||!_0x5ea2b3,!_0x4e2890[_0x962a6a(0x296)]&&((_0xc2449=_0x4e2890['location'])==null?void 0x0:_0xc2449[_0x962a6a(0x27b)])&&(_0x4e2890['_consoleNinjaAllowedToStart']=_0x13af12[_0x962a6a(0x2cd)](_0x2ab088=>_0x2ab088(_0x4e2890[_0x962a6a(0x2af)][_0x962a6a(0x27b)]))),_0x5f2bc0&&!_0x4e2890[_0x962a6a(0x296)]&&!((_0x52f0a9=_0x4e2890[_0x962a6a(0x2af)])!=null&&_0x52f0a9[_0x962a6a(0x27b)])&&(_0x4e2890['_consoleNinjaAllowedToStart']=!0x0),_0x4e2890['_consoleNinjaAllowedToStart'];}function J(_0x1e3740,_0x2ac493,_0x55181e,_0x390824,_0x149d45,_0x206368){var _0x5e2a73=_0x1af38a;_0x1e3740=_0x1e3740,_0x2ac493=_0x2ac493,_0x55181e=_0x55181e,_0x390824=_0x390824,_0x149d45=_0x149d45,_0x149d45=_0x149d45||{},_0x149d45[_0x5e2a73(0x2ec)]=_0x149d45[_0x5e2a73(0x2ec)]||{},_0x149d45[_0x5e2a73(0x216)]=_0x149d45[_0x5e2a73(0x216)]||{},_0x149d45['reducePolicy']=_0x149d45[_0x5e2a73(0x2a1)]||{},_0x149d45['reducePolicy'][_0x5e2a73(0x2e9)]=_0x149d45[_0x5e2a73(0x2a1)][_0x5e2a73(0x2e9)]||{},_0x149d45['reducePolicy']['global']=_0x149d45[_0x5e2a73(0x2a1)][_0x5e2a73(0x291)]||{};let _0xfc778c={'perLogpoint':{'reduceOnCount':_0x149d45[_0x5e2a73(0x2a1)][_0x5e2a73(0x2e9)]['reduceOnCount']||0x32,'reduceOnAccumulatedProcessingTimeMs':_0x149d45['reducePolicy']['perLogpoint']['reduceOnAccumulatedProcessingTimeMs']||0x64,'resetWhenQuietMs':_0x149d45[_0x5e2a73(0x2a1)][_0x5e2a73(0x2e9)][_0x5e2a73(0x213)]||0x1f4,'resetOnProcessingTimeAverageMs':_0x149d45[_0x5e2a73(0x2a1)][_0x5e2a73(0x2e9)]['resetOnProcessingTimeAverageMs']||0x64},'global':{'reduceOnCount':_0x149d45['reducePolicy']['global'][_0x5e2a73(0x29c)]||0x3e8,'reduceOnAccumulatedProcessingTimeMs':_0x149d45[_0x5e2a73(0x2a1)][_0x5e2a73(0x291)]['reduceOnAccumulatedProcessingTimeMs']||0x12c,'resetWhenQuietMs':_0x149d45[_0x5e2a73(0x2a1)][_0x5e2a73(0x291)]['resetWhenQuietMs']||0x32,'resetOnProcessingTimeAverageMs':_0x149d45[_0x5e2a73(0x2a1)][_0x5e2a73(0x291)]['resetOnProcessingTimeAverageMs']||0x64}},_0x2b445d=b(_0x1e3740),_0x56be92=_0x2b445d[_0x5e2a73(0x298)],_0x136289=_0x2b445d[_0x5e2a73(0x261)];function _0x3e0e54(){var _0x4f72bd=_0x5e2a73;this[_0x4f72bd(0x21c)]=/^(?!(?:do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$)[_$a-zA-Z\\xA0-\\uFFFF][_$a-zA-Z0-9\\xA0-\\uFFFF]*$/,this[_0x4f72bd(0x204)]=/^(0|[1-9][0-9]*)$/,this['_quotedRegExp']=/'([^\\\\']|\\\\')*'/,this['_undefined']=_0x1e3740[_0x4f72bd(0x284)],this['_HTMLAllCollection']=_0x1e3740[_0x4f72bd(0x265)],this[_0x4f72bd(0x2e3)]=Object['getOwnPropertyDescriptor'],this[_0x4f72bd(0x2dd)]=Object[_0x4f72bd(0x20d)],this[_0x4f72bd(0x2a8)]=_0x1e3740[_0x4f72bd(0x21a)],this[_0x4f72bd(0x280)]=RegExp[_0x4f72bd(0x271)][_0x4f72bd(0x27c)],this['_dateToString']=Date[_0x4f72bd(0x271)][_0x4f72bd(0x27c)];}_0x3e0e54[_0x5e2a73(0x271)]['serialize']=function(_0x398c3a,_0x33e196,_0x43092f,_0x33cf9a){var _0x4cce42=_0x5e2a73,_0x683b6e=this,_0x4812f7=_0x43092f['autoExpand'];function _0x162cad(_0x55923b,_0x224282,_0x56bc08){var _0x4b2d8a=_0x460b;_0x224282['type']='unknown',_0x224282[_0x4b2d8a(0x2b2)]=_0x55923b[_0x4b2d8a(0x1eb)],_0x319538=_0x56bc08['node'][_0x4b2d8a(0x2c6)],_0x56bc08[_0x4b2d8a(0x21b)][_0x4b2d8a(0x2c6)]=_0x224282,_0x683b6e[_0x4b2d8a(0x2a0)](_0x224282,_0x56bc08);}let _0x20a50d,_0x107da9,_0x2c03d3=_0x1e3740[_0x4cce42(0x275)];_0x1e3740[_0x4cce42(0x275)]=!0x0,_0x1e3740[_0x4cce42(0x243)]&&(_0x20a50d=_0x1e3740[_0x4cce42(0x243)][_0x4cce42(0x2b2)],_0x107da9=_0x1e3740['console'][_0x4cce42(0x2ed)],_0x20a50d&&(_0x1e3740[_0x4cce42(0x243)]['error']=function(){}),_0x107da9&&(_0x1e3740[_0x4cce42(0x243)]['warn']=function(){}));try{try{_0x43092f[_0x4cce42(0x1ee)]++,_0x43092f[_0x4cce42(0x220)]&&_0x43092f[_0x4cce42(0x1e3)][_0x4cce42(0x23a)](_0x33e196);var _0x3b8289,_0x13202c,_0x1fb279,_0x3ec721,_0x1fdb20=[],_0x455855=[],_0x4d56ac,_0x17318f=this[_0x4cce42(0x230)](_0x33e196),_0x4363d2=_0x17318f===_0x4cce42(0x251),_0x1782ef=!0x1,_0x3f196b=_0x17318f===_0x4cce42(0x2d9),_0x482a1f=this[_0x4cce42(0x2d8)](_0x17318f),_0x39e356=this[_0x4cce42(0x278)](_0x17318f),_0xed252f=_0x482a1f||_0x39e356,_0x106223={},_0x367b3e=0x0,_0x3bc6e0=!0x1,_0x319538,_0x53726b=/^(([1-9]{1}[0-9]*)|0)$/;if(_0x43092f['depth']){if(_0x4363d2){if(_0x13202c=_0x33e196[_0x4cce42(0x1e9)],_0x13202c>_0x43092f['elements']){for(_0x1fb279=0x0,_0x3ec721=_0x43092f[_0x4cce42(0x1e7)],_0x3b8289=_0x1fb279;_0x3b8289<_0x3ec721;_0x3b8289++)_0x455855[_0x4cce42(0x23a)](_0x683b6e['_addProperty'](_0x1fdb20,_0x33e196,_0x17318f,_0x3b8289,_0x43092f));_0x398c3a['cappedElements']=!0x0;}else{for(_0x1fb279=0x0,_0x3ec721=_0x13202c,_0x3b8289=_0x1fb279;_0x3b8289<_0x3ec721;_0x3b8289++)_0x455855[_0x4cce42(0x23a)](_0x683b6e[_0x4cce42(0x211)](_0x1fdb20,_0x33e196,_0x17318f,_0x3b8289,_0x43092f));}_0x43092f[_0x4cce42(0x2b6)]+=_0x455855[_0x4cce42(0x1e9)];}if(!(_0x17318f==='null'||_0x17318f===_0x4cce42(0x284))&&!_0x482a1f&&_0x17318f!=='String'&&_0x17318f!=='Buffer'&&_0x17318f!==_0x4cce42(0x259)){var _0x415b3e=_0x33cf9a['props']||_0x43092f[_0x4cce42(0x2ab)];if(this[_0x4cce42(0x24e)](_0x33e196)?(_0x3b8289=0x0,_0x33e196[_0x4cce42(0x2e4)](function(_0x4ea0ab){var _0x5468f6=_0x4cce42;if(_0x367b3e++,_0x43092f[_0x5468f6(0x2b6)]++,_0x367b3e>_0x415b3e){_0x3bc6e0=!0x0;return;}if(!_0x43092f[_0x5468f6(0x2ef)]&&_0x43092f['autoExpand']&&_0x43092f[_0x5468f6(0x2b6)]>_0x43092f['autoExpandLimit']){_0x3bc6e0=!0x0;return;}_0x455855[_0x5468f6(0x23a)](_0x683b6e[_0x5468f6(0x211)](_0x1fdb20,_0x33e196,_0x5468f6(0x2b9),_0x3b8289++,_0x43092f,function(_0x3593ec){return function(){return _0x3593ec;};}(_0x4ea0ab)));})):this[_0x4cce42(0x2be)](_0x33e196)&&_0x33e196['forEach'](function(_0x5f22fb,_0x27ad05){var _0xd71f46=_0x4cce42;if(_0x367b3e++,_0x43092f[_0xd71f46(0x2b6)]++,_0x367b3e>_0x415b3e){_0x3bc6e0=!0x0;return;}if(!_0x43092f['isExpressionToEvaluate']&&_0x43092f[_0xd71f46(0x220)]&&_0x43092f[_0xd71f46(0x2b6)]>_0x43092f[_0xd71f46(0x279)]){_0x3bc6e0=!0x0;return;}var _0x505456=_0x27ad05[_0xd71f46(0x27c)]();_0x505456['length']>0x64&&(_0x505456=_0x505456[_0xd71f46(0x1ff)](0x0,0x64)+_0xd71f46(0x2df)),_0x455855[_0xd71f46(0x23a)](_0x683b6e[_0xd71f46(0x211)](_0x1fdb20,_0x33e196,_0xd71f46(0x26c),_0x505456,_0x43092f,function(_0x329738){return function(){return _0x329738;};}(_0x5f22fb)));}),!_0x1782ef){try{for(_0x4d56ac in _0x33e196)if(!(_0x4363d2&&_0x53726b[_0x4cce42(0x2c3)](_0x4d56ac))&&!this['_blacklistedProperty'](_0x33e196,_0x4d56ac,_0x43092f)){if(_0x367b3e++,_0x43092f[_0x4cce42(0x2b6)]++,_0x367b3e>_0x415b3e){_0x3bc6e0=!0x0;break;}if(!_0x43092f[_0x4cce42(0x2ef)]&&_0x43092f[_0x4cce42(0x220)]&&_0x43092f[_0x4cce42(0x2b6)]>_0x43092f[_0x4cce42(0x279)]){_0x3bc6e0=!0x0;break;}_0x455855[_0x4cce42(0x23a)](_0x683b6e[_0x4cce42(0x294)](_0x1fdb20,_0x106223,_0x33e196,_0x17318f,_0x4d56ac,_0x43092f));}}catch{}if(_0x106223[_0x4cce42(0x26d)]=!0x0,_0x3f196b&&(_0x106223[_0x4cce42(0x2ca)]=!0x0),!_0x3bc6e0){var _0x3b080c=[][_0x4cce42(0x2da)](this[_0x4cce42(0x2dd)](_0x33e196))[_0x4cce42(0x2da)](this[_0x4cce42(0x217)](_0x33e196));for(_0x3b8289=0x0,_0x13202c=_0x3b080c[_0x4cce42(0x1e9)];_0x3b8289<_0x13202c;_0x3b8289++)if(_0x4d56ac=_0x3b080c[_0x3b8289],!(_0x4363d2&&_0x53726b[_0x4cce42(0x2c3)](_0x4d56ac[_0x4cce42(0x27c)]()))&&!this[_0x4cce42(0x1e4)](_0x33e196,_0x4d56ac,_0x43092f)&&!_0x106223[typeof _0x4d56ac!=_0x4cce42(0x22b)?_0x4cce42(0x274)+_0x4d56ac[_0x4cce42(0x27c)]():_0x4d56ac]){if(_0x367b3e++,_0x43092f[_0x4cce42(0x2b6)]++,_0x367b3e>_0x415b3e){_0x3bc6e0=!0x0;break;}if(!_0x43092f['isExpressionToEvaluate']&&_0x43092f[_0x4cce42(0x220)]&&_0x43092f['autoExpandPropertyCount']>_0x43092f['autoExpandLimit']){_0x3bc6e0=!0x0;break;}_0x455855[_0x4cce42(0x23a)](_0x683b6e[_0x4cce42(0x294)](_0x1fdb20,_0x106223,_0x33e196,_0x17318f,_0x4d56ac,_0x43092f));}}}}}if(_0x398c3a['type']=_0x17318f,_0xed252f?(_0x398c3a[_0x4cce42(0x2e7)]=_0x33e196[_0x4cce42(0x24a)](),this[_0x4cce42(0x202)](_0x17318f,_0x398c3a,_0x43092f,_0x33cf9a)):_0x17318f==='date'?_0x398c3a[_0x4cce42(0x2e7)]=this[_0x4cce42(0x205)][_0x4cce42(0x292)](_0x33e196):_0x17318f==='bigint'?_0x398c3a[_0x4cce42(0x2e7)]=_0x33e196[_0x4cce42(0x27c)]():_0x17318f===_0x4cce42(0x237)?_0x398c3a[_0x4cce42(0x2e7)]=this['_regExpToString'][_0x4cce42(0x292)](_0x33e196):_0x17318f===_0x4cce42(0x22b)&&this[_0x4cce42(0x2a8)]?_0x398c3a[_0x4cce42(0x2e7)]=this[_0x4cce42(0x2a8)][_0x4cce42(0x271)]['toString'][_0x4cce42(0x292)](_0x33e196):!_0x43092f['depth']&&!(_0x17318f===_0x4cce42(0x2ce)||_0x17318f===_0x4cce42(0x284))&&(delete _0x398c3a[_0x4cce42(0x2e7)],_0x398c3a[_0x4cce42(0x266)]=!0x0),_0x3bc6e0&&(_0x398c3a['cappedProps']=!0x0),_0x319538=_0x43092f['node'][_0x4cce42(0x2c6)],_0x43092f[_0x4cce42(0x21b)][_0x4cce42(0x2c6)]=_0x398c3a,this['_treeNodePropertiesBeforeFullValue'](_0x398c3a,_0x43092f),_0x455855[_0x4cce42(0x1e9)]){for(_0x3b8289=0x0,_0x13202c=_0x455855[_0x4cce42(0x1e9)];_0x3b8289<_0x13202c;_0x3b8289++)_0x455855[_0x3b8289](_0x3b8289);}_0x1fdb20[_0x4cce42(0x1e9)]&&(_0x398c3a[_0x4cce42(0x2ab)]=_0x1fdb20);}catch(_0x5e09b1){_0x162cad(_0x5e09b1,_0x398c3a,_0x43092f);}this[_0x4cce42(0x242)](_0x33e196,_0x398c3a),this['_treeNodePropertiesAfterFullValue'](_0x398c3a,_0x43092f),_0x43092f[_0x4cce42(0x21b)][_0x4cce42(0x2c6)]=_0x319538,_0x43092f['level']--,_0x43092f['autoExpand']=_0x4812f7,_0x43092f[_0x4cce42(0x220)]&&_0x43092f['autoExpandPreviousObjects'][_0x4cce42(0x29a)]();}finally{_0x20a50d&&(_0x1e3740[_0x4cce42(0x243)][_0x4cce42(0x2b2)]=_0x20a50d),_0x107da9&&(_0x1e3740[_0x4cce42(0x243)][_0x4cce42(0x2ed)]=_0x107da9),_0x1e3740['ninjaSuppressConsole']=_0x2c03d3;}return _0x398c3a;},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x217)]=function(_0x5b4474){var _0x5d49e7=_0x5e2a73;return Object[_0x5d49e7(0x1fb)]?Object[_0x5d49e7(0x1fb)](_0x5b4474):[];},_0x3e0e54[_0x5e2a73(0x271)]['_isSet']=function(_0xc01063){var _0x1815c9=_0x5e2a73;return!!(_0xc01063&&_0x1e3740['Set']&&this['_objectToString'](_0xc01063)===_0x1815c9(0x1ed)&&_0xc01063[_0x1815c9(0x2e4)]);},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x1e4)]=function(_0x310905,_0x47e907,_0x2ce025){var _0x53f31e=_0x5e2a73;if(!_0x2ce025[_0x53f31e(0x208)]){let _0x459dbb=this[_0x53f31e(0x2e3)](_0x310905,_0x47e907);if(_0x459dbb&&_0x459dbb[_0x53f31e(0x215)])return!0x0;}return _0x2ce025[_0x53f31e(0x2f2)]?typeof _0x310905[_0x47e907]=='function':!0x1;},_0x3e0e54['prototype'][_0x5e2a73(0x230)]=function(_0x34c79a){var _0x35c573=_0x5e2a73,_0x46b0e7='';return _0x46b0e7=typeof _0x34c79a,_0x46b0e7===_0x35c573(0x295)?this['_objectToString'](_0x34c79a)===_0x35c573(0x297)?_0x46b0e7=_0x35c573(0x251):this['_objectToString'](_0x34c79a)===_0x35c573(0x1e5)?_0x46b0e7=_0x35c573(0x2a6):this[_0x35c573(0x25b)](_0x34c79a)===_0x35c573(0x28f)?_0x46b0e7=_0x35c573(0x259):_0x34c79a===null?_0x46b0e7=_0x35c573(0x2ce):_0x34c79a[_0x35c573(0x2b7)]&&(_0x46b0e7=_0x34c79a['constructor']['name']||_0x46b0e7):_0x46b0e7==='undefined'&&this[_0x35c573(0x2e5)]&&_0x34c79a instanceof this[_0x35c573(0x2e5)]&&(_0x46b0e7=_0x35c573(0x265)),_0x46b0e7;},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x25b)]=function(_0x56bddd){var _0x44c8a0=_0x5e2a73;return Object[_0x44c8a0(0x271)][_0x44c8a0(0x27c)][_0x44c8a0(0x292)](_0x56bddd);},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x2d8)]=function(_0x2ab2ee){var _0x4e8ddb=_0x5e2a73;return _0x2ab2ee===_0x4e8ddb(0x2b1)||_0x2ab2ee===_0x4e8ddb(0x21e)||_0x2ab2ee===_0x4e8ddb(0x234);},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x278)]=function(_0x385177){var _0x3fbafc=_0x5e2a73;return _0x385177===_0x3fbafc(0x1f3)||_0x385177===_0x3fbafc(0x2f3)||_0x385177===_0x3fbafc(0x26f);},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x211)]=function(_0x905f8e,_0x4338fa,_0x55c56b,_0x1ed8ed,_0x1a97bc,_0xc4e316){var _0x4c84dd=this;return function(_0x914108){var _0x456b56=_0x460b,_0x327032=_0x1a97bc[_0x456b56(0x21b)][_0x456b56(0x2c6)],_0xc6089a=_0x1a97bc[_0x456b56(0x21b)][_0x456b56(0x219)],_0x2daa55=_0x1a97bc[_0x456b56(0x21b)][_0x456b56(0x260)];_0x1a97bc[_0x456b56(0x21b)][_0x456b56(0x260)]=_0x327032,_0x1a97bc[_0x456b56(0x21b)][_0x456b56(0x219)]=typeof _0x1ed8ed==_0x456b56(0x234)?_0x1ed8ed:_0x914108,_0x905f8e[_0x456b56(0x23a)](_0x4c84dd['_property'](_0x4338fa,_0x55c56b,_0x1ed8ed,_0x1a97bc,_0xc4e316)),_0x1a97bc[_0x456b56(0x21b)][_0x456b56(0x260)]=_0x2daa55,_0x1a97bc[_0x456b56(0x21b)][_0x456b56(0x219)]=_0xc6089a;};},_0x3e0e54['prototype'][_0x5e2a73(0x294)]=function(_0x14b98d,_0x4fd84e,_0xb9e40f,_0x23781c,_0x2af2f0,_0x27f872,_0x1c6029){var _0x23a278=_0x5e2a73,_0x3b4848=this;return _0x4fd84e[typeof _0x2af2f0!=_0x23a278(0x22b)?'_p_'+_0x2af2f0['toString']():_0x2af2f0]=!0x0,function(_0x14efd2){var _0x49ac32=_0x23a278,_0x4cdd46=_0x27f872[_0x49ac32(0x21b)][_0x49ac32(0x2c6)],_0x38dfec=_0x27f872[_0x49ac32(0x21b)]['index'],_0x4c8876=_0x27f872[_0x49ac32(0x21b)][_0x49ac32(0x260)];_0x27f872[_0x49ac32(0x21b)][_0x49ac32(0x260)]=_0x4cdd46,_0x27f872[_0x49ac32(0x21b)]['index']=_0x14efd2,_0x14b98d[_0x49ac32(0x23a)](_0x3b4848[_0x49ac32(0x270)](_0xb9e40f,_0x23781c,_0x2af2f0,_0x27f872,_0x1c6029)),_0x27f872[_0x49ac32(0x21b)][_0x49ac32(0x260)]=_0x4c8876,_0x27f872[_0x49ac32(0x21b)][_0x49ac32(0x219)]=_0x38dfec;};},_0x3e0e54[_0x5e2a73(0x271)]['_property']=function(_0x4bc83b,_0x5daf97,_0x202195,_0x37b352,_0xa4aa21){var _0x39bd34=_0x5e2a73,_0x3faa50=this;_0xa4aa21||(_0xa4aa21=function(_0x3b7098,_0x83dd16){return _0x3b7098[_0x83dd16];});var _0xde72c4=_0x202195[_0x39bd34(0x27c)](),_0x16f431=_0x37b352['expressionsToEvaluate']||{},_0x4ded93=_0x37b352[_0x39bd34(0x2bc)],_0x53e728=_0x37b352[_0x39bd34(0x2ef)];try{var _0x45e8a1=this[_0x39bd34(0x2be)](_0x4bc83b),_0x4bf0c1=_0xde72c4;_0x45e8a1&&_0x4bf0c1[0x0]==='\\x27'&&(_0x4bf0c1=_0x4bf0c1[_0x39bd34(0x20e)](0x1,_0x4bf0c1['length']-0x2));var _0x146ce5=_0x37b352[_0x39bd34(0x2d3)]=_0x16f431[_0x39bd34(0x274)+_0x4bf0c1];_0x146ce5&&(_0x37b352[_0x39bd34(0x2bc)]=_0x37b352[_0x39bd34(0x2bc)]+0x1),_0x37b352[_0x39bd34(0x2ef)]=!!_0x146ce5;var _0x453967=typeof _0x202195==_0x39bd34(0x22b),_0x152f52={'name':_0x453967||_0x45e8a1?_0xde72c4:this[_0x39bd34(0x209)](_0xde72c4)};if(_0x453967&&(_0x152f52[_0x39bd34(0x22b)]=!0x0),!(_0x5daf97===_0x39bd34(0x251)||_0x5daf97===_0x39bd34(0x1f8))){var _0x2170aa=this['_getOwnPropertyDescriptor'](_0x4bc83b,_0x202195);if(_0x2170aa&&(_0x2170aa[_0x39bd34(0x2c0)]&&(_0x152f52[_0x39bd34(0x2cb)]=!0x0),_0x2170aa[_0x39bd34(0x215)]&&!_0x146ce5&&!_0x37b352[_0x39bd34(0x208)]))return _0x152f52['getter']=!0x0,this['_processTreeNodeResult'](_0x152f52,_0x37b352),_0x152f52;}var _0x107e0d;try{_0x107e0d=_0xa4aa21(_0x4bc83b,_0x202195);}catch(_0x1d4b21){return _0x152f52={'name':_0xde72c4,'type':'unknown','error':_0x1d4b21[_0x39bd34(0x1eb)]},this[_0x39bd34(0x272)](_0x152f52,_0x37b352),_0x152f52;}var _0xd850b8=this[_0x39bd34(0x230)](_0x107e0d),_0x3c2f6a=this[_0x39bd34(0x2d8)](_0xd850b8);if(_0x152f52[_0x39bd34(0x21f)]=_0xd850b8,_0x3c2f6a)this[_0x39bd34(0x272)](_0x152f52,_0x37b352,_0x107e0d,function(){var _0x2a4966=_0x39bd34;_0x152f52[_0x2a4966(0x2e7)]=_0x107e0d[_0x2a4966(0x24a)](),!_0x146ce5&&_0x3faa50[_0x2a4966(0x202)](_0xd850b8,_0x152f52,_0x37b352,{});});else{var _0x32c4c2=_0x37b352[_0x39bd34(0x220)]&&_0x37b352[_0x39bd34(0x1ee)]<_0x37b352[_0x39bd34(0x2ae)]&&_0x37b352[_0x39bd34(0x1e3)][_0x39bd34(0x281)](_0x107e0d)<0x0&&_0xd850b8!==_0x39bd34(0x2d9)&&_0x37b352[_0x39bd34(0x2b6)]<_0x37b352[_0x39bd34(0x279)];_0x32c4c2||_0x37b352['level']<_0x4ded93||_0x146ce5?this['serialize'](_0x152f52,_0x107e0d,_0x37b352,_0x146ce5||{}):this['_processTreeNodeResult'](_0x152f52,_0x37b352,_0x107e0d,function(){var _0x47f220=_0x39bd34;_0xd850b8==='null'||_0xd850b8===_0x47f220(0x284)||(delete _0x152f52[_0x47f220(0x2e7)],_0x152f52[_0x47f220(0x266)]=!0x0);});}return _0x152f52;}finally{_0x37b352[_0x39bd34(0x2d3)]=_0x16f431,_0x37b352['depth']=_0x4ded93,_0x37b352[_0x39bd34(0x2ef)]=_0x53e728;}},_0x3e0e54['prototype'][_0x5e2a73(0x202)]=function(_0x435375,_0x45ee12,_0x5b952e,_0x5cacc4){var _0x20fd0e=_0x5e2a73,_0xea38d=_0x5cacc4[_0x20fd0e(0x2e8)]||_0x5b952e[_0x20fd0e(0x2e8)];if((_0x435375===_0x20fd0e(0x21e)||_0x435375==='String')&&_0x45ee12[_0x20fd0e(0x2e7)]){let _0x9d1d3=_0x45ee12[_0x20fd0e(0x2e7)][_0x20fd0e(0x1e9)];_0x5b952e[_0x20fd0e(0x293)]+=_0x9d1d3,_0x5b952e[_0x20fd0e(0x293)]>_0x5b952e[_0x20fd0e(0x287)]?(_0x45ee12[_0x20fd0e(0x266)]='',delete _0x45ee12[_0x20fd0e(0x2e7)]):_0x9d1d3>_0xea38d&&(_0x45ee12[_0x20fd0e(0x266)]=_0x45ee12['value']['substr'](0x0,_0xea38d),delete _0x45ee12[_0x20fd0e(0x2e7)]);}},_0x3e0e54[_0x5e2a73(0x271)]['_isMap']=function(_0x2bd6ef){var _0x3f5147=_0x5e2a73;return!!(_0x2bd6ef&&_0x1e3740[_0x3f5147(0x26c)]&&this[_0x3f5147(0x25b)](_0x2bd6ef)===_0x3f5147(0x252)&&_0x2bd6ef['forEach']);},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x209)]=function(_0x474d53){var _0x30316c=_0x5e2a73;if(_0x474d53[_0x30316c(0x1ef)](/^\\d+$/))return _0x474d53;var _0x3f69ab;try{_0x3f69ab=JSON[_0x30316c(0x25f)](''+_0x474d53);}catch{_0x3f69ab='\\x22'+this[_0x30316c(0x25b)](_0x474d53)+'\\x22';}return _0x3f69ab[_0x30316c(0x1ef)](/^\"([a-zA-Z_][a-zA-Z_0-9]*)\"$/)?_0x3f69ab=_0x3f69ab[_0x30316c(0x20e)](0x1,_0x3f69ab[_0x30316c(0x1e9)]-0x2):_0x3f69ab=_0x3f69ab['replace'](/'/g,'\\x5c\\x27')[_0x30316c(0x236)](/\\\\\"/g,'\\x22')[_0x30316c(0x236)](/(^\"|\"$)/g,'\\x27'),_0x3f69ab;},_0x3e0e54['prototype']['_processTreeNodeResult']=function(_0x364d07,_0xce68e5,_0x2a28f0,_0x263891){var _0x15e3a3=_0x5e2a73;this['_treeNodePropertiesBeforeFullValue'](_0x364d07,_0xce68e5),_0x263891&&_0x263891(),this['_additionalMetadata'](_0x2a28f0,_0x364d07),this[_0x15e3a3(0x1ea)](_0x364d07,_0xce68e5);},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x2a0)]=function(_0xf6f60a,_0x5be566){var _0x32d52f=_0x5e2a73;this[_0x32d52f(0x22c)](_0xf6f60a,_0x5be566),this[_0x32d52f(0x2c7)](_0xf6f60a,_0x5be566),this[_0x32d52f(0x2ac)](_0xf6f60a,_0x5be566),this[_0x32d52f(0x231)](_0xf6f60a,_0x5be566);},_0x3e0e54['prototype']['_setNodeId']=function(_0xabd75d,_0x638106){},_0x3e0e54[_0x5e2a73(0x271)]['_setNodeQueryPath']=function(_0x4e71fb,_0x3659f9){},_0x3e0e54['prototype'][_0x5e2a73(0x2c5)]=function(_0x441fb,_0x1ec2ac){},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x1f0)]=function(_0x11907b){return _0x11907b===this['_undefined'];},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x1ea)]=function(_0x237f52,_0x2ad303){var _0x1a0f4f=_0x5e2a73;this[_0x1a0f4f(0x2c5)](_0x237f52,_0x2ad303),this[_0x1a0f4f(0x1f4)](_0x237f52),_0x2ad303['sortProps']&&this[_0x1a0f4f(0x2b8)](_0x237f52),this[_0x1a0f4f(0x2a4)](_0x237f52,_0x2ad303),this[_0x1a0f4f(0x264)](_0x237f52,_0x2ad303),this[_0x1a0f4f(0x232)](_0x237f52);},_0x3e0e54['prototype']['_additionalMetadata']=function(_0x3a5aec,_0x486988){var _0x31f735=_0x5e2a73;try{_0x3a5aec&&typeof _0x3a5aec[_0x31f735(0x1e9)]=='number'&&(_0x486988[_0x31f735(0x1e9)]=_0x3a5aec[_0x31f735(0x1e9)]);}catch{}if(_0x486988['type']===_0x31f735(0x234)||_0x486988[_0x31f735(0x21f)]===_0x31f735(0x26f)){if(isNaN(_0x486988[_0x31f735(0x2e7)]))_0x486988[_0x31f735(0x23f)]=!0x0,delete _0x486988[_0x31f735(0x2e7)];else switch(_0x486988[_0x31f735(0x2e7)]){case Number[_0x31f735(0x2bf)]:_0x486988[_0x31f735(0x2dc)]=!0x0,delete _0x486988[_0x31f735(0x2e7)];break;case Number[_0x31f735(0x28e)]:_0x486988[_0x31f735(0x28a)]=!0x0,delete _0x486988[_0x31f735(0x2e7)];break;case 0x0:this[_0x31f735(0x28b)](_0x486988[_0x31f735(0x2e7)])&&(_0x486988[_0x31f735(0x20f)]=!0x0);break;}}else _0x486988['type']==='function'&&typeof _0x3a5aec[_0x31f735(0x2e6)]==_0x31f735(0x21e)&&_0x3a5aec['name']&&_0x486988[_0x31f735(0x2e6)]&&_0x3a5aec[_0x31f735(0x2e6)]!==_0x486988[_0x31f735(0x2e6)]&&(_0x486988[_0x31f735(0x200)]=_0x3a5aec[_0x31f735(0x2e6)]);},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x28b)]=function(_0x4345cc){return 0x1/_0x4345cc===Number['NEGATIVE_INFINITY'];},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x2b8)]=function(_0x510c7f){var _0x10f2bf=_0x5e2a73;!_0x510c7f[_0x10f2bf(0x2ab)]||!_0x510c7f[_0x10f2bf(0x2ab)][_0x10f2bf(0x1e9)]||_0x510c7f[_0x10f2bf(0x21f)]===_0x10f2bf(0x251)||_0x510c7f[_0x10f2bf(0x21f)]==='Map'||_0x510c7f['type']==='Set'||_0x510c7f[_0x10f2bf(0x2ab)][_0x10f2bf(0x24b)](function(_0x2c63bc,_0x3ff9b0){var _0x1c2c37=_0x10f2bf,_0x52dfa9=_0x2c63bc[_0x1c2c37(0x2e6)][_0x1c2c37(0x2d0)](),_0x1220e7=_0x3ff9b0[_0x1c2c37(0x2e6)][_0x1c2c37(0x2d0)]();return _0x52dfa9<_0x1220e7?-0x1:_0x52dfa9>_0x1220e7?0x1:0x0;});},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x2a4)]=function(_0x31672e,_0x188900){var _0x1f9fbc=_0x5e2a73;if(!(_0x188900[_0x1f9fbc(0x2f2)]||!_0x31672e[_0x1f9fbc(0x2ab)]||!_0x31672e[_0x1f9fbc(0x2ab)][_0x1f9fbc(0x1e9)])){for(var _0x32fa25=[],_0x4ebd7a=[],_0xa63df0=0x0,_0x5c7635=_0x31672e[_0x1f9fbc(0x2ab)][_0x1f9fbc(0x1e9)];_0xa63df0<_0x5c7635;_0xa63df0++){var _0x815784=_0x31672e['props'][_0xa63df0];_0x815784[_0x1f9fbc(0x21f)]==='function'?_0x32fa25[_0x1f9fbc(0x23a)](_0x815784):_0x4ebd7a['push'](_0x815784);}if(!(!_0x4ebd7a[_0x1f9fbc(0x1e9)]||_0x32fa25['length']<=0x1)){_0x31672e[_0x1f9fbc(0x2ab)]=_0x4ebd7a;var _0x17b141={'functionsNode':!0x0,'props':_0x32fa25};this['_setNodeId'](_0x17b141,_0x188900),this[_0x1f9fbc(0x2c5)](_0x17b141,_0x188900),this[_0x1f9fbc(0x1f4)](_0x17b141),this[_0x1f9fbc(0x231)](_0x17b141,_0x188900),_0x17b141['id']+='\\x20f',_0x31672e[_0x1f9fbc(0x2ab)][_0x1f9fbc(0x2aa)](_0x17b141);}}},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x264)]=function(_0x3d8aff,_0x5be1aa){},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x1f4)]=function(_0x1ee8a2){},_0x3e0e54['prototype'][_0x5e2a73(0x263)]=function(_0x5f0a45){var _0x5c2b4b=_0x5e2a73;return Array[_0x5c2b4b(0x2ba)](_0x5f0a45)||typeof _0x5f0a45==_0x5c2b4b(0x295)&&this[_0x5c2b4b(0x25b)](_0x5f0a45)===_0x5c2b4b(0x297);},_0x3e0e54[_0x5e2a73(0x271)]['_setNodePermissions']=function(_0x31eabe,_0x2376f3){},_0x3e0e54[_0x5e2a73(0x271)]['_cleanNode']=function(_0x3df17a){var _0x165631=_0x5e2a73;delete _0x3df17a[_0x165631(0x262)],delete _0x3df17a[_0x165631(0x2b5)],delete _0x3df17a[_0x165631(0x268)];},_0x3e0e54[_0x5e2a73(0x271)][_0x5e2a73(0x2ac)]=function(_0x49f2cf,_0x2460ec){};let _0x3d0cd4=new _0x3e0e54(),_0xb63b8d={'props':_0x149d45[_0x5e2a73(0x2ec)][_0x5e2a73(0x2ab)]||0x64,'elements':_0x149d45['defaultLimits'][_0x5e2a73(0x1e7)]||0x64,'strLength':_0x149d45[_0x5e2a73(0x2ec)][_0x5e2a73(0x2e8)]||0x400*0x32,'totalStrLength':_0x149d45[_0x5e2a73(0x2ec)][_0x5e2a73(0x287)]||0x400*0x32,'autoExpandLimit':_0x149d45[_0x5e2a73(0x2ec)][_0x5e2a73(0x279)]||0x1388,'autoExpandMaxDepth':_0x149d45[_0x5e2a73(0x2ec)][_0x5e2a73(0x2ae)]||0xa},_0x40ab4e={'props':_0x149d45['reducedLimits']['props']||0x5,'elements':_0x149d45[_0x5e2a73(0x216)][_0x5e2a73(0x1e7)]||0x5,'strLength':_0x149d45[_0x5e2a73(0x216)][_0x5e2a73(0x2e8)]||0x100,'totalStrLength':_0x149d45[_0x5e2a73(0x216)]['totalStrLength']||0x100*0x3,'autoExpandLimit':_0x149d45[_0x5e2a73(0x216)][_0x5e2a73(0x279)]||0x1e,'autoExpandMaxDepth':_0x149d45[_0x5e2a73(0x216)][_0x5e2a73(0x2ae)]||0x2};if(_0x206368){let _0x4f9c8d=_0x3d0cd4[_0x5e2a73(0x2e2)][_0x5e2a73(0x2f4)](_0x3d0cd4);_0x3d0cd4[_0x5e2a73(0x2e2)]=function(_0x38aaf0,_0x46c8a6,_0x2c8c37,_0x67a49c){return _0x4f9c8d(_0x38aaf0,_0x206368(_0x46c8a6),_0x2c8c37,_0x67a49c);};}function _0xb1a7ab(_0x3e4679,_0x4d9077,_0x4a45eb,_0x208ae5,_0x1fdc88,_0x80618e){var _0x366ca6=_0x5e2a73;let _0x58fe56,_0x69424f;try{_0x69424f=_0x136289(),_0x58fe56=_0x55181e[_0x4d9077],!_0x58fe56||_0x69424f-_0x58fe56['ts']>_0xfc778c[_0x366ca6(0x2e9)][_0x366ca6(0x213)]&&_0x58fe56[_0x366ca6(0x1f6)]&&_0x58fe56[_0x366ca6(0x214)]/_0x58fe56[_0x366ca6(0x1f6)]<_0xfc778c[_0x366ca6(0x2e9)][_0x366ca6(0x238)]?(_0x55181e[_0x4d9077]=_0x58fe56={'count':0x0,'time':0x0,'ts':_0x69424f},_0x55181e[_0x366ca6(0x201)]={}):_0x69424f-_0x55181e[_0x366ca6(0x201)]['ts']>_0xfc778c[_0x366ca6(0x291)][_0x366ca6(0x213)]&&_0x55181e[_0x366ca6(0x201)]['count']&&_0x55181e[_0x366ca6(0x201)][_0x366ca6(0x214)]/_0x55181e[_0x366ca6(0x201)][_0x366ca6(0x1f6)]<_0xfc778c[_0x366ca6(0x291)][_0x366ca6(0x238)]&&(_0x55181e['hits']={});let _0x318650=[],_0x35742d=_0x58fe56['reduceLimits']||_0x55181e['hits'][_0x366ca6(0x2c8)]?_0x40ab4e:_0xb63b8d,_0x4c6b58=_0x477bf8=>{var _0x1f8348=_0x366ca6;let _0x5b17ef={};return _0x5b17ef[_0x1f8348(0x2ab)]=_0x477bf8[_0x1f8348(0x2ab)],_0x5b17ef['elements']=_0x477bf8[_0x1f8348(0x1e7)],_0x5b17ef[_0x1f8348(0x2e8)]=_0x477bf8[_0x1f8348(0x2e8)],_0x5b17ef[_0x1f8348(0x287)]=_0x477bf8[_0x1f8348(0x287)],_0x5b17ef[_0x1f8348(0x279)]=_0x477bf8['autoExpandLimit'],_0x5b17ef['autoExpandMaxDepth']=_0x477bf8['autoExpandMaxDepth'],_0x5b17ef['sortProps']=!0x1,_0x5b17ef['noFunctions']=!_0x2ac493,_0x5b17ef[_0x1f8348(0x2bc)]=0x1,_0x5b17ef[_0x1f8348(0x1ee)]=0x0,_0x5b17ef[_0x1f8348(0x224)]=_0x1f8348(0x285),_0x5b17ef[_0x1f8348(0x257)]=_0x1f8348(0x221),_0x5b17ef[_0x1f8348(0x220)]=!0x0,_0x5b17ef[_0x1f8348(0x1e3)]=[],_0x5b17ef['autoExpandPropertyCount']=0x0,_0x5b17ef[_0x1f8348(0x208)]=_0x149d45[_0x1f8348(0x208)],_0x5b17ef[_0x1f8348(0x293)]=0x0,_0x5b17ef[_0x1f8348(0x21b)]={'current':void 0x0,'parent':void 0x0,'index':0x0},_0x5b17ef;};for(var _0x6eab0a=0x0;_0x6eab0a<_0x1fdc88['length'];_0x6eab0a++)_0x318650[_0x366ca6(0x23a)](_0x3d0cd4[_0x366ca6(0x2e2)]({'timeNode':_0x3e4679==='time'||void 0x0},_0x1fdc88[_0x6eab0a],_0x4c6b58(_0x35742d),{}));if(_0x3e4679===_0x366ca6(0x2c2)||_0x3e4679===_0x366ca6(0x2b2)){let _0x2dd1cd=Error[_0x366ca6(0x2f0)];try{Error['stackTraceLimit']=0x1/0x0,_0x318650[_0x366ca6(0x23a)](_0x3d0cd4['serialize']({'stackNode':!0x0},new Error()[_0x366ca6(0x269)],_0x4c6b58(_0x35742d),{'strLength':0x1/0x0}));}finally{Error[_0x366ca6(0x2f0)]=_0x2dd1cd;}}return{'method':_0x366ca6(0x247),'version':_0x390824,'args':[{'ts':_0x4a45eb,'session':_0x208ae5,'args':_0x318650,'id':_0x4d9077,'context':_0x80618e}]};}catch(_0x4ea249){return{'method':_0x366ca6(0x247),'version':_0x390824,'args':[{'ts':_0x4a45eb,'session':_0x208ae5,'args':[{'type':_0x366ca6(0x25c),'error':_0x4ea249&&_0x4ea249[_0x366ca6(0x1eb)]}],'id':_0x4d9077,'context':_0x80618e}]};}finally{try{if(_0x58fe56&&_0x69424f){let _0x17e9af=_0x136289();_0x58fe56['count']++,_0x58fe56[_0x366ca6(0x214)]+=_0x56be92(_0x69424f,_0x17e9af),_0x58fe56['ts']=_0x17e9af,_0x55181e[_0x366ca6(0x201)][_0x366ca6(0x1f6)]++,_0x55181e[_0x366ca6(0x201)][_0x366ca6(0x214)]+=_0x56be92(_0x69424f,_0x17e9af),_0x55181e[_0x366ca6(0x201)]['ts']=_0x17e9af,(_0x58fe56[_0x366ca6(0x1f6)]>_0xfc778c['perLogpoint'][_0x366ca6(0x29c)]||_0x58fe56['time']>_0xfc778c[_0x366ca6(0x2e9)][_0x366ca6(0x2bb)])&&(_0x58fe56[_0x366ca6(0x2c8)]=!0x0),(_0x55181e[_0x366ca6(0x201)]['count']>_0xfc778c[_0x366ca6(0x291)]['reduceOnCount']||_0x55181e[_0x366ca6(0x201)][_0x366ca6(0x214)]>_0xfc778c['global'][_0x366ca6(0x2bb)])&&(_0x55181e[_0x366ca6(0x201)][_0x366ca6(0x2c8)]=!0x0);}}catch{}}}return _0xb1a7ab;}function G(_0x9e2d4f){var _0x3397de=_0x1af38a;if(_0x9e2d4f&&typeof _0x9e2d4f=='object'&&_0x9e2d4f[_0x3397de(0x2b7)])switch(_0x9e2d4f[_0x3397de(0x2b7)][_0x3397de(0x2e6)]){case _0x3397de(0x2ee):return _0x9e2d4f['hasOwnProperty'](Symbol['iterator'])?Promise[_0x3397de(0x254)]():_0x9e2d4f;case _0x3397de(0x23d):return Promise[_0x3397de(0x254)]();}return _0x9e2d4f;}((_0x5b6f3a,_0x1bffa2,_0xbe632c,_0x287f3f,_0x1783f0,_0xcaefca,_0x28b8e0,_0x14b478,_0x14c3ff,_0x45807a,_0x32bd24,_0x5846b6)=>{var _0x58fd26=_0x1af38a;if(_0x5b6f3a[_0x58fd26(0x299)])return _0x5b6f3a[_0x58fd26(0x299)];let _0x490b02={'consoleLog':()=>{},'consoleTrace':()=>{},'consoleTime':()=>{},'consoleTimeEnd':()=>{},'autoLog':()=>{},'autoLogMany':()=>{},'autoTraceMany':()=>{},'coverage':()=>{},'autoTrace':()=>{},'autoTime':()=>{},'autoTimeEnd':()=>{}};if(!X(_0x5b6f3a,_0x14b478,_0x1783f0))return _0x5b6f3a[_0x58fd26(0x299)]=_0x490b02,_0x5b6f3a[_0x58fd26(0x299)];let _0x1ff91f=b(_0x5b6f3a),_0x4f2276=_0x1ff91f[_0x58fd26(0x298)],_0x342601=_0x1ff91f[_0x58fd26(0x261)],_0x4746bd=_0x1ff91f[_0x58fd26(0x1f5)],_0x460e6d={'hits':{},'ts':{}},_0xf4694=J(_0x5b6f3a,_0x14c3ff,_0x460e6d,_0xcaefca,_0x5846b6,_0x1783f0===_0x58fd26(0x1fc)?G:void 0x0),_0x5e6433=(_0x489661,_0x4823f4,_0x428ae1,_0x7ab9c6,_0x78aede,_0x1f003c)=>{let _0x2f9d2d=_0x5b6f3a['_console_ninja'];try{return _0x5b6f3a['_console_ninja']=_0x490b02,_0xf4694(_0x489661,_0x4823f4,_0x428ae1,_0x7ab9c6,_0x78aede,_0x1f003c);}finally{_0x5b6f3a['_console_ninja']=_0x2f9d2d;}},_0x1b3758=_0xfac0bd=>{_0x460e6d['ts'][_0xfac0bd]=_0x342601();},_0x490274=(_0x3b06a6,_0x450fc9)=>{var _0x47bfcf=_0x58fd26;let _0x2b18e4=_0x460e6d['ts'][_0x450fc9];if(delete _0x460e6d['ts'][_0x450fc9],_0x2b18e4){let _0x3e7763=_0x4f2276(_0x2b18e4,_0x342601());_0x37013d(_0x5e6433(_0x47bfcf(0x214),_0x3b06a6,_0x4746bd(),_0x5a4cfc,[_0x3e7763],_0x450fc9));}},_0x3d6453=_0x591ed3=>{var _0x29fd57=_0x58fd26,_0x337099;return _0x1783f0==='next.js'&&_0x5b6f3a[_0x29fd57(0x1fa)]&&((_0x337099=_0x591ed3==null?void 0x0:_0x591ed3[_0x29fd57(0x23c)])==null?void 0x0:_0x337099[_0x29fd57(0x1e9)])&&(_0x591ed3[_0x29fd57(0x23c)][0x0][_0x29fd57(0x1fa)]=_0x5b6f3a[_0x29fd57(0x1fa)]),_0x591ed3;};_0x5b6f3a[_0x58fd26(0x299)]={'consoleLog':(_0x18465d,_0x48967c)=>{var _0x2e2c0f=_0x58fd26;_0x5b6f3a['console'][_0x2e2c0f(0x247)][_0x2e2c0f(0x2e6)]!==_0x2e2c0f(0x229)&&_0x37013d(_0x5e6433(_0x2e2c0f(0x247),_0x18465d,_0x4746bd(),_0x5a4cfc,_0x48967c));},'consoleTrace':(_0x3281d1,_0x107b96)=>{var _0x369f44=_0x58fd26,_0x59457b,_0x2b2420;_0x5b6f3a[_0x369f44(0x243)][_0x369f44(0x247)]['name']!==_0x369f44(0x203)&&((_0x2b2420=(_0x59457b=_0x5b6f3a[_0x369f44(0x289)])==null?void 0x0:_0x59457b[_0x369f44(0x207)])!=null&&_0x2b2420[_0x369f44(0x21b)]&&(_0x5b6f3a[_0x369f44(0x258)]=!0x0),_0x37013d(_0x3d6453(_0x5e6433('trace',_0x3281d1,_0x4746bd(),_0x5a4cfc,_0x107b96))));},'consoleError':(_0x18cf6e,_0x50724a)=>{var _0x28e983=_0x58fd26;_0x5b6f3a[_0x28e983(0x258)]=!0x0,_0x37013d(_0x3d6453(_0x5e6433(_0x28e983(0x2b2),_0x18cf6e,_0x4746bd(),_0x5a4cfc,_0x50724a)));},'consoleTime':_0x46c63c=>{_0x1b3758(_0x46c63c);},'consoleTimeEnd':(_0x517857,_0x407075)=>{_0x490274(_0x407075,_0x517857);},'autoLog':(_0x1b3cbb,_0xc7dce7)=>{var _0x45f794=_0x58fd26;_0x37013d(_0x5e6433(_0x45f794(0x247),_0xc7dce7,_0x4746bd(),_0x5a4cfc,[_0x1b3cbb]));},'autoLogMany':(_0x3ffbc8,_0xa50b)=>{_0x37013d(_0x5e6433('log',_0x3ffbc8,_0x4746bd(),_0x5a4cfc,_0xa50b));},'autoTrace':(_0x4f835c,_0x13448c)=>{var _0x1ea755=_0x58fd26;_0x37013d(_0x3d6453(_0x5e6433(_0x1ea755(0x2c2),_0x13448c,_0x4746bd(),_0x5a4cfc,[_0x4f835c])));},'autoTraceMany':(_0x27e105,_0x119f42)=>{var _0x4f4517=_0x58fd26;_0x37013d(_0x3d6453(_0x5e6433(_0x4f4517(0x2c2),_0x27e105,_0x4746bd(),_0x5a4cfc,_0x119f42)));},'autoTime':(_0x46ab83,_0x55dd6b,_0x5a6561)=>{_0x1b3758(_0x5a6561);},'autoTimeEnd':(_0x15856d,_0x4d0977,_0x433471)=>{_0x490274(_0x4d0977,_0x433471);},'coverage':_0x491c36=>{_0x37013d({'method':'coverage','version':_0xcaefca,'args':[{'id':_0x491c36}]});}};let _0x37013d=H(_0x5b6f3a,_0x1bffa2,_0xbe632c,_0x287f3f,_0x1783f0,_0x45807a,_0x32bd24),_0x5a4cfc=_0x5b6f3a[_0x58fd26(0x2a2)];return _0x5b6f3a['_console_ninja'];})(globalThis,_0x1af38a(0x273),_0x1af38a(0x2c9),\"c:\\\\Users\\\\Justin\\\\.vscode\\\\extensions\\\\wallabyjs.console-ninja-1.0.541\\\\node_modules\",_0x1af38a(0x24f),_0x1af38a(0x245),_0x1af38a(0x2a5),_0x1af38a(0x26b),_0x1af38a(0x2d7),_0x1af38a(0x206),'1',_0x1af38a(0x2d4));");}catch(e){}};/* istanbul ignore next */function oo_oo(i:string,...v:any[]){try{oo_cm().consoleLog(i, v);}catch(e){} return v};oo_oo;/* istanbul ignore next */function oo_tr(i:string,...v:any[]){try{oo_cm().consoleTrace(i, v);}catch(e){} return v};oo_tr;/* istanbul ignore next */function oo_tx(i:string,...v:any[]){try{oo_cm().consoleError(i, v);}catch(e){} return v};oo_tx;/* istanbul ignore next */function oo_ts(v?:string):string{try{oo_cm().consoleTime(v);}catch(e){} return v as string;};oo_ts;/* istanbul ignore next */function oo_te(v:string|undefined, i:string):string{try{oo_cm().consoleTimeEnd(v, i);}catch(e){} return v as string;};oo_te;/*eslint unicorn/no-abusive-eslint-disable:,eslint-comments/disable-enable-pair:,eslint-comments/no-unlimited-disable:,eslint-comments/no-aggregating-enable:,eslint-comments/no-duplicate-disable:,eslint-comments/no-unused-disable:,eslint-comments/no-unused-enable:,*/