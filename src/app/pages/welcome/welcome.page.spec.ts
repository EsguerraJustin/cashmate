import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { WelcomePage } from './welcome.page';
import { FIREBASE_AUTH } from '../../core/firebase.tokens';

describe('WelcomePage', () => {
  let component: WelcomePage;
  let fixture: ComponentFixture<WelcomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WelcomePage],
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
        { provide: ActivatedRoute, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
