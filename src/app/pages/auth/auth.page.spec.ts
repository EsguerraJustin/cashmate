import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { AuthPage } from './auth.page';
import { FIREBASE_AUTH } from '../../core/firebase.tokens';
import { FirestoreDataService } from '../../services/firestore-data.service';

describe('AuthPage', () => {
  let component: AuthPage;
  let fixture: ComponentFixture<AuthPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthPage],
      providers: [
        {
          provide: Router,
          useValue: { navigateByUrl: () => Promise.resolve(true) },
        },
        {
          provide: ToastController,
          useValue: {
            create: () =>
              Promise.resolve({ present: () => Promise.resolve() }),
          },
        },
        { provide: FIREBASE_AUTH, useValue: {} },
        {
          provide: FirestoreDataService,
          useValue: {
            saveSettings: () => Promise.resolve(),
            saveCategories: () => Promise.resolve(),
          },
        },
        { provide: ActivatedRoute, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
