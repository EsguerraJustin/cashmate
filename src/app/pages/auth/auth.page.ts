import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonInput,
  ToastController,
} from '@ionic/angular';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { FIREBASE_AUTH } from '../../core/firebase.tokens';
import { FirestoreDataService } from '../../services/firestore-data.service';
import { defaultSettings } from '../../models/budget.model';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss'],
  imports: [IonContent, IonInput, IonButton, FormsModule, RouterLink],
})
export class AuthPage {
  private readonly router = inject(Router);
  private readonly toastController = inject(ToastController);
  private readonly dataService = inject(FirestoreDataService);
  private readonly auth = inject<Auth>(FIREBASE_AUTH);

  name = '';
  email = '';
  password = '';

  async signUp(): Promise<void> {
    const email = this.email.trim();
    const displayName = this.name.trim();
    if (!displayName) {
      await this.showError('Please enter your name.');
      return;
    }
    if (!email || !this.password) {
      await this.showError('Please enter your email and password.');
      return;
    }
    try {
      const credential = await createUserWithEmailAndPassword(
        this.auth,
        email,
        this.password
      );
      if (credential.user) {
        await updateProfile(credential.user, { displayName });
        await this.dataService.saveSettings({
          ...defaultSettings(),
          displayName,
        });
      }
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
      case 'auth/email-already-in-use':
        return 'That email is already registered. Try logging in instead.';
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/weak-password':
        return 'Please choose a stronger password (6+ characters).';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-up is not enabled. Contact support.';
      default:
        return 'Sign-up failed. Please try again.';
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
