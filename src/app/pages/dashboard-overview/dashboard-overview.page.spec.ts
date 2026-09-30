import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { DashboardOverviewPage } from './dashboard-overview.page';
import { FirestoreDataService } from '../../services/firestore-data.service';
import { FIREBASE_AUTH } from '../../core/firebase.tokens';
import type { AppSettings, Category, SavingsGoal } from '../../models/budget.model';

const SETTINGS: AppSettings = {
  displayName: 'Justin',
  selectedPeriod: '2026-09',
  rollLeftover: true,
  incomes: [],
  incomesByPeriod: {},
  recurring: [],
  targetSavings: 0,
};

const CATEGORY: Category = {
  name: 'Rent',
  tone: 'bills',
  amountLimit: 10000,
  amountSpent: 0,
  expenses: [],
  period: '2026-09',
};

describe('DashboardOverviewPage', () => {
  let component: DashboardOverviewPage;
  let fixture: ComponentFixture<DashboardOverviewPage>;
  let goals: SavingsGoal[];

  /** `rawCategories` and `loadCategories` are private; reach them the same way
   *  a snapshot callback would. */
  const setCategories = (list: Category[]) =>
    (component as unknown as { rawCategories: Category[] }).rawCategories = list;

  const reload = () =>
    (component as unknown as { loadCategories: () => void }).loadCategories();

  beforeEach(async () => {
    goals = [
      { id: 'g1', name: 'Emergency Fund', targetAmount: 50000, savedAmount: 12500, tone: 'goal' },
      { id: 'g2', name: 'Laptop', targetAmount: 80000, savedAmount: 0, tone: 'goal' },
    ];

    await TestBed.configureTestingModule({
      imports: [DashboardOverviewPage],
      providers: [
        { provide: Router, useValue: { navigateByUrl: () => Promise.resolve(true) } },
        {
          provide: FirestoreDataService,
          useValue: {
            watchCategories: () => of([CATEGORY]),
            watchSettings: () => of(SETTINGS),
            watchGoals: () => of(goals),
            watchSavingsGoal: () => of(50000),
            saveSettings: () => Promise.resolve(),
            saveCategories: () => Promise.resolve(),
            saveGoals: () => Promise.resolve(),
          },
        },
        { provide: FIREBASE_AUTH, useValue: { currentUser: { displayName: 'Justin', email: 'j@e.com' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardOverviewPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });


  describe('savings goals', () => {

    it('reads the goals the user created on /dashboard', () => {
      expect(component.savingsGoals.map((g) => g.name)).toEqual([
        'Emergency Fund',
        'Laptop',
      ]);
    });

    it('exposes them through visibleGoals', () => {
      expect(component.visibleGoals.length).toBe(2);
      expect(component.visibleGoals[0].targetAmount).toBe(50000);
    });

    it('renders each goal name into the view', () => {
      // Regression: this page has no ngModel bindings and no host listeners,
      // so before the signal conversion nothing ever scheduled a render after
      // load and the savings section stayed on its empty-state card.
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Emergency Fund');
      expect(text).toContain('Laptop');
    });

    it('does not show the "add a goal" placeholder when goals exist', () => {
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Add a goal from Monthly Expenses');
    });

    it('reports progress from the saved amount, not leftover cash', () => {
      expect(component.goalPercent(component.savingsGoals[0])).toBe(25);
      expect(component.goalPercent(component.savingsGoals[1])).toBe(0);
    });

    it('keeps the target when the month has no categories', () => {
      // `resetDashboard` used to zero `targetGoal`, which silently discarded
      // the user's savings target and forced a synthetic 0% goal.
      setCategories([]);
      component.settings = { ...SETTINGS, selectedPeriod: '2026-01' };
      component.targetGoal = 50000;

      reload();

      expect(component.targetGoal).toBe(50000);
      expect(component.visibleGoals.length).toBe(2);
    });

  });


  describe('category totals', () => {

    it('uses the entered limit for a new category rather than double it', () => {
      const fresh: Category = {
        name: 'Food',
        tone: 'shopping',
        amountLimit: 5000,
        amountSpent: 0,
        expenses: [],
        period: '2026-09',
      };
      setCategories([fresh]);
      reload();

      expect(component.totalBudget).toBe(5000);
      expect(component.categories[0].limit).toBe(5000);
      expect(component.categories[0].percent).toBe(0);
    });

  });
});
