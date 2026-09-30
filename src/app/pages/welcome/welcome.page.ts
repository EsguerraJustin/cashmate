import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonInput,
  ToastController,
} from '@ionic/angular';
import { signInWithEmailAndPassword } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { FIREBASE_AUTH } from '../../core/firebase.tokens';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.page.html',
  styleUrls: ['./welcome.page.scss'],
  imports: [IonContent, IonInput, IonButton, FormsModule, RouterLink],
})
export class WelcomePage {
  private readonly router = inject(Router);
  private readonly toastController = inject(ToastController);
  private readonly auth = inject<Auth>(FIREBASE_AUTH);

  username = '';
  email = '';
  password = '';

  async login(): Promise<void> {
    // `username` is the legacy field in welcome.page.html. Prefer `email`
    // when present so a future email input works without TS changes.
    const email = (this.email?.trim() || this.username?.trim()) ?? '';
    if (!email || !this.password) {
      await this.showError('Please enter your email and password.');
      return;
    }
    try {
      await signInWithEmailAndPassword(this.auth, email, this.password);
      await this.router.navigateByUrl('/dashboard');
    } catch (error: unknown) {
      await this.showError(this.authErrorMessage(error));
    }
  }

  private authErrorMessage(error: unknown): string {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
    switch (code) {
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Wrong email or password. Please try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please try again later.';
      default:
        return 'Login failed. Please try again.';
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
