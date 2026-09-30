import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { ToastController } from '@ionic/angular';
import { DashboardPage } from './dashboard.page';
import { FirestoreDataService } from '../../services/firestore-data.service';
import { FIREBASE_AUTH } from '../../core/firebase.tokens';

describe('DashboardPage', () => {
  let component: DashboardPage;
  let fixture: ComponentFixture<DashboardPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        {
          provide: Router,
          useValue: { navigateByUrl: () => Promise.resolve(true) },
        },
        {
          provide: FirestoreDataService,
          useValue: {
            watchCategories: () => of([]),
            watchSavingsGoal: () => of(0),
            watchSettings: () => of({
              displayName: '',
              selectedPeriod: '2026-09',
              rollLeftover: true,
              incomes: [],
              recurring: [],
              targetSavings: 0,
            }),
            watchGoals: () => of([]),
            saveCategories: () => Promise.resolve(),
            saveSavingsGoal: () => Promise.resolve(),
            saveSettings: () => Promise.resolve(),
            saveGoals: () => Promise.resolve(),
          },
        },
        { provide: FIREBASE_AUTH, useValue: { currentUser: null } },
        {
          provide: ToastController,
          useValue: {
            create: () =>
              Promise.resolve({ present: () => Promise.resolve() }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });


  describe('category search and tone filters', () => {

    beforeEach(() => {
      component.categories = [
        { name: 'Groceries', tone: 'shopping', amountLimit: 100, amountSpent: 0, expenses: [] },
        { name: 'Rent', tone: 'bills', amountLimit: 100, amountSpent: 0, expenses: [] },
        { name: 'Fare', tone: 'transport', amountLimit: 100, amountSpent: 0, expenses: [] },
      ];
    });

    it('shows everything when no filter is active', () => {
      expect(component.visibleCategories.length).toBe(3);
      expect(component.hasActiveFilters).toBe(false);
    });

    it('matches names case-insensitively as a substring', () => {
      component.searchQuery = 'GRO';
      expect(component.visibleCategories.map((c) => c.name)).toEqual([
        'Groceries',
      ]);
    });

    it('narrows by tone', () => {
      component.setToneFilter('bills');
      expect(component.visibleCategories.map((c) => c.name)).toEqual(['Rent']);
      expect(component.hasActiveFilters).toBe(true);
    });

    it('treats the "all" chip as no tone filter', () => {
      component.setToneFilter('bills');
      component.setToneFilter('all');
      expect(component.activeTone).toBeNull();
      expect(component.visibleCategories.length).toBe(3);
    });

    it('combines search and tone', () => {
      component.setToneFilter('shopping');
      component.searchQuery = 'zzz';
      expect(component.visibleCategories).toEqual([]);
      expect(component.hasActiveFilters).toBe(true);
    });

    it('clearFilters restores the full list', () => {
      component.setToneFilter('bills');
      component.searchQuery = 'ren';
      component.clearFilters();
      expect(component.searchQuery).toBe('');
      expect(component.activeTone).toBeNull();
      expect(component.visibleCategories.length).toBe(3);
    });
  });


  describe('deleteCategory', () => {

    let saved: unknown[] | null;
    let confirmAnswer: boolean;
    let service: FirestoreDataService;

    beforeEach(() => {
      saved = null;
      confirmAnswer = true;
      service = TestBed.inject(FirestoreDataService);
      vi.spyOn(service, 'saveCategories').mockImplementation((cats) => {
        saved = cats as unknown[];
        return Promise.resolve();
      });
      vi.spyOn(service, 'saveSettings').mockImplementation(() => Promise.resolve());
      vi.spyOn(window, 'confirm').mockImplementation(() => confirmAnswer);
      vi.spyOn(component, 'closeCategoryDetail').mockImplementation(
        () => undefined
      );
    });

    it('deletes by name even when selectedCategory is a stale reference', async () => {
      // Simulates a Firestore snapshot replacing this.categories with fresh
      // objects while the modal still holds the old reference.
      component.categories = [
        { name: 'Rent', tone: 'bills', amountLimit: 100, amountSpent: 0, expenses: [] },
        { name: 'Fare', tone: 'transport', amountLimit: 100, amountSpent: 0, expenses: [] },
      ];
      component.selectedCategory = { name: 'Rent', tone: 'bills', amountLimit: 100, amountSpent: 0, expenses: [] };

      await component.deleteCategory();

      expect(component.categories.map((c) => c.name)).toEqual(['Fare']);
      expect(saved).not.toBeNull();
    });

    it('does nothing when the user cancels the confirm', async () => {
      confirmAnswer = false;
      component.categories = [
        { name: 'Rent', tone: 'bills', amountLimit: 100, amountSpent: 0, expenses: [] },
      ];
      component.selectedCategory = { name: 'Rent', tone: 'bills', amountLimit: 100, amountSpent: 0, expenses: [] };

      await component.deleteCategory();

      expect(component.categories.length).toBe(1);
      expect(saved).toBeNull();
    });

    it('drops recurring rules that pointed at the deleted category', async () => {
      component.categories = [
        { name: 'Rent', tone: 'bills', amountLimit: 100, amountSpent: 0, expenses: [] },
      ];
      component.selectedCategory = { name: 'Rent', tone: 'bills', amountLimit: 100, amountSpent: 0, expenses: [] };
      component.settings = {
        ...component.settings,
        recurring: [
          {
            id: 'r1',
            categoryName: 'Rent',
            amount: 1000,
            note: '',
            frequency: 'monthly',
            dayOfMonth: 5,
            dayOfWeek: 1,
            lastAppliedPeriod: '',
            lastAppliedDate: '',
          },
        ],
      };

      await component.deleteCategory();

      expect(component.settings.recurring).toEqual([]);
    });
  });


  describe('per-month categories', () => {

    const cat = (name: string, period: string | null, limit = 100) => ({
      name,
      tone: 'shopping',
      amountLimit: limit,
      amountSpent: 0,
      expenses: [],
      period,
    });

    beforeEach(() => {
      component.categories = [
        cat('Rent', '2026-01', 10000),
        cat('Fare', '2026-01', 500),
        cat('Rent', '2026-02', 12000),
      ];
    });

    it('scopes the view to the selected month', () => {
      component.settings = {
        ...component.settings,
        selectedPeriod: '2026-01',
      };
      expect(component.periodCategories.map((c) => c.name)).toEqual([
        'Rent',
        'Fare',
      ]);

      component.settings = {
        ...component.settings,
        selectedPeriod: '2026-02',
      };
      expect(component.periodCategories.map((c) => c.name)).toEqual(['Rent']);
    });

    it('keeps same-named categories in different months apart', () => {
      component.settings = {
        ...component.settings,
        selectedPeriod: '2026-02',
        rollLeftover: false,
      };
      expect(component.totalLimit).toBe(12000);
    });

    it('rolls leftover from the previous month, not from itself', () => {
      // January "Rent" spent 4000 of its 10000, so 6000 carries into February.
      component.categories = [
        {
          ...cat('Rent', '2026-01', 10000),
          expenses: [
            { id: 'e1', amount: 4000, date: '2026-01-10T00:00:00.000Z', note: '' },
          ],
        },
        cat('Rent', '2026-02', 12000),
      ];
      component.settings = {
        ...component.settings,
        selectedPeriod: '2026-02',
        rollLeftover: true,
      };
      // 12000 base + 6000 leftover. Before the fix this read 0 spent on the
      // February object and doubled to 24000.
      expect(component.limitOf(component.categories[1])).toBe(18000);
    });

    it('treats a missing period as the current month', () => {
      const now = new Date();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      component.categories = [cat('Legacy', null)];
      expect(component.periodCategories.map((c) => c.name)).toEqual(['Legacy']);
    });

    it('reports an empty month when other months have categories', () => {
      component.settings = {
        ...component.settings,
        selectedPeriod: '2025-12',
      };
      expect(component.hasCategories).toBe(false);
      expect(component.hasAnyCategories).toBe(true);
      expect(component.isPeriodEmpty).toBe(true);
    });

    it('copies the previous month without carrying expenses over', () => {
      component.categories = [
        {
          ...cat('Rent', '2026-01', 10000),
          expenses: [
            { id: 'e1', amount: 500, date: '2026-01-05T00:00:00.000Z', note: '' },
          ],
        },
      ];
      component.settings = {
        ...component.settings,
        selectedPeriod: '2026-02',
      };

      component.copyPreviousMonthCategories();

      const february = component.periodCategories;
      expect(february.map((c) => c.name)).toEqual(['Rent']);
      expect(february[0].amountLimit).toBe(10000);
      expect(february[0].expenses).toEqual([]);
      expect(component.categories[0].expenses.length).toBe(1);
    });

    it('does not duplicate a name that already exists in the target month', () => {
      component.settings = {
        ...component.settings,
        selectedPeriod: '2026-02',
      };
      component.copyPreviousMonthCategories();
      const february = component.periodCategories;
      expect(february.filter((c) => c.name === 'Rent').length).toBe(1);
    });
  });


  it('deletes only the category in the selected month', async () => {
    vi.spyOn(TestBed.inject(FirestoreDataService), 'saveCategories').mockImplementation(
      () => Promise.resolve()
    );
    vi.spyOn(TestBed.inject(FirestoreDataService), 'saveSettings').mockImplementation(
      () => Promise.resolve()
    );
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    vi.spyOn(component, 'closeCategoryDetail').mockImplementation(() => undefined);

    component.settings = { ...component.settings, selectedPeriod: '2026-01' };
    component.categories = [
      { name: 'Rent', tone: 'bills', amountLimit: 1, amountSpent: 0, expenses: [], period: '2026-01' },
      { name: 'Rent', tone: 'bills', amountLimit: 2, amountSpent: 0, expenses: [], period: '2026-02' },
    ];
    component.selectedCategory = {
      name: 'Rent', tone: 'bills', amountLimit: 1, amountSpent: 0, expenses: [], period: '2026-01',
    };

    await component.deleteCategory();

    expect(component.categories.length).toBe(1);
    expect(component.categories[0].period).toBe('2026-02');
  });


  describe('toolbar menus', () => {

    it('closing Actions also closes the profile menu', () => {
      component.profileMenuOpen = true;
      component.menuOpen = false;

      component.toggleMenu(new MouseEvent('click'));

      expect(component.menuOpen).toBe(true);
      expect(component.profileMenuOpen).toBe(false);
    });

    it('closing the profile menu also closes Actions', () => {
      component.menuOpen = true;
      component.profileMenuOpen = false;

      component.toggleProfileMenu(new MouseEvent('click'));

      expect(component.profileMenuOpen).toBe(true);
      expect(component.menuOpen).toBe(false);
    });

    it('never leaves both menus open at once', () => {
      component.toggleMenu(new MouseEvent('click'));
      component.toggleProfileMenu(new MouseEvent('click'));
      expect(component.menuOpen && component.profileMenuOpen).toBe(false);

      component.toggleProfileMenu(new MouseEvent('click'));
      component.toggleMenu(new MouseEvent('click'));
      expect(component.menuOpen && component.profileMenuOpen).toBe(false);
    });

    it('an outside click closes both menus', () => {
      component.menuOpen = true;
      component.profileMenuOpen = true;

      component.closeMenusOnOutsideClick();

      expect(component.menuOpen).toBe(false);
      expect(component.profileMenuOpen).toBe(false);
    });
  });


  it('no longer offers a Recurring Expense action', () => {
    expect(component.actions.map((a) => a.label)).not.toContain(
      'Recurring Expense'
    );
  });

  it('moves Log Out and Edit display name out of the actions list', () => {
    const labels = component.actions.map((a) => a.label);
    expect(labels).not.toContain('Log Out');
    expect(labels).not.toContain('Edit display name');
    expect(component.profileActions.map((a) => a.label)).toEqual([
      'Edit display name',
      'Log Out',
    ]);
  });
});
