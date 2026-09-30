import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { ResetPasswordPage } from './reset-password.page';

describe('ResetPasswordPage', () => {
  let fixture: ComponentFixture<ResetPasswordPage>;
  let component: ResetPasswordPage;

  async function createWith(params: Record<string, string>): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        {
          provide: Router,
          useValue: { navigateByUrl: () => Promise.resolve(true) },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap(params)) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResetPasswordPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('shows the success state with no query params', async () => {
    await createWith({});
    expect(component.status).toBe('done');
    expect(component.headline).toBe('Password updated');
  });

  it('reports an expired reset link', async () => {
    await createWith({ errorCode: 'PASSWORD_RESET_EXPIRED' });
    expect(component.status).toBe('error');
    expect(component.message).toContain('expired');
  });

  it('falls back to generic copy for an unknown error code', async () => {
    await createWith({ errorCode: 'SOMETHING_ELSE' });
    expect(component.status).toBe('error');
    expect(component.message).toContain('Something went wrong');
  });
});
