import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonButton, IonContent } from '@ionic/angular';

/**
 * Landing page for the `continueUrl` passed to `sendPasswordResetEmail`.
 *
 * `handleCodeInApp` is left at its default (false), so Firebase serves its
 * own action widget and collects the new password there. All this page has
 * to do is confirm the flow finished and route the user back to login. It
 * must not try to read a token out of the query string — there isn't one.
 */
@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.page.html',
  styleUrls: ['reset-password.page.scss'],
  imports: [IonContent, IonButton, RouterLink],
})
export class ResetPasswordPage implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Firebase appends `errorCode` when the emailed link itself fails. */
  errorCode = '';

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.errorCode = params.get('errorCode') ?? '';
    });
  }

  get status(): 'error' | 'done' {
    return this.errorCode ? 'error' : 'done';
  }

  get headline(): string {
    switch (this.status) {
      case 'error':
        return 'That reset link did not work';
      default:
        return 'Password updated';
    }
  }

  get message(): string {
    switch (this.status) {
      case 'error':
        return this.errorMessage();
      default:
        return 'Your password has been reset. Log in with your new password to get back to CashMate.';
    }
  }

  backToLogin(): void {
    void this.router.navigateByUrl('/welcome');
  }

  private errorMessage(): string {
    switch (this.errorCode) {
      case 'PASSWORD_RESET_EXPIRED':
        return 'That link has expired. Request a fresh reset email and try again.';
      case 'INVALID_IDP_RESPONSE_ID':
      case 'MISSING_CONTINUE_URL':
        return 'That link is incomplete or invalid. Request a fresh reset email and try again.';
      default:
        return 'Something went wrong with that reset link. Request a fresh one and try again.';
    }
  }
}
