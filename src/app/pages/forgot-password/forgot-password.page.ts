import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonInput,
  ToastController,
} from '@ionic/angular';
import { sendPasswordResetEmail } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { FIREBASE_AUTH } from '../../core/firebase.tokens';

const RESET_PATH = '/reset-password';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.page.html',
  styleUrls: ['forgot-password.page.scss'],
  imports: [IonContent, IonInput, IonButton, FormsModule, RouterLink],
})
export class ForgotPasswordPage {
  private readonly router = inject(Router);
  private readonly toastController = inject(ToastController);
  private readonly auth = inject<Auth>(FIREBASE_AUTH);

  email = '';

  sent = false;

  /**
   * Firebase serves its own reset widget and then redirects here, so the
   * continue URL must be a route we own. Public for testing.
   */
  get resetContinueUrl(): string {
    const origin =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : '';
    return `${origin}${RESET_PATH}`;
  }

  async sendResetLink(): Promise<void> {
    const email = this.email.trim();
    if (!email) {
      await this.showError('Please enter your email address.');
      return;
    }

    try {
      await sendPasswordResetEmail(this.auth, email, {
        url: this.resetContinueUrl,
      });
      this.sent = true;
    } catch (error: unknown) {
      // `auth/user-not-found` deliberately gets the same neutral copy as
      // success, so this form cannot be used to discover which emails
      // are registered.
      const code = this.authErrorCode(error);
      if (code === 'auth/user-not-found') {
        this.sent = true;
        return;
      }
      await this.showError(this.authErrorMessage(code));
    }
  }

  backToLogin(): void {
    void this.router.navigateByUrl('/welcome');
  }

  private authErrorCode(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  }

  private authErrorMessage(code: string): string {
    switch (code) {
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/missing-email':
        return 'Please enter your email address.';
      case 'auth/operation-not-allowed':
        return 'Password reset emails are not enabled for this project yet. Enable them in the Firebase console.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please try again later.';
      default:
        return 'Could not send the reset link. Please try again.';
    }
  }

  private async showError(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 3500,
      position: 'bottom',
      color: 'danger',
    });
    await toast.present();
  }
}
