import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ForgotPasswordPage } from './forgot-password.page';
import { FIREBASE_AUTH } from '../../core/firebase.tokens';

describe('ForgotPasswordPage', () => {
  let component: ForgotPasswordPage;
  let fixture: ComponentFixture<ForgotPasswordPage>;
  let toastMessages: string[];

  beforeEach(async () => {
    toastMessages = [];

    await TestBed.configureTestingModule({
      imports: [ForgotPasswordPage],
      providers: [
        {
          provide: Router,
          useValue: { navigateByUrl: () => Promise.resolve(true) },
        },
        {
          provide: ToastController,
          useValue: {
            create: (opts: { message: string }) => {
              toastMessages.push(opts.message);
              return Promise.resolve({ present: () => Promise.resolve() });
            },
          },
        },
        { provide: FIREBASE_AUTH, useValue: {} },
        { provide: ActivatedRoute, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts with no email and nothing sent', () => {
    expect(component.email).toBe('');
    expect(component.sent).toBe(false);
  });

  it('blocks an empty email with a single error toast', async () => {
    await component.sendResetLink();
    expect(toastMessages).toEqual(['Please enter your email address.']);
    expect(component.sent).toBe(false);
  });

  it('points the continue url at the /reset-password route', () => {
    // Firebase redirects back to this URL after the reset widget finishes,
    // so it has to stay in sync with app.routes.ts.
    expect(component.resetContinueUrl.endsWith('/reset-password')).toBe(true);
  });
});
