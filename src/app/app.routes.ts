import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'welcome',
    pathMatch: 'full',
  },
  {
    path: 'welcome',
    loadComponent: () => import('./pages/welcome/welcome.page').then((m) => m.WelcomePage),
  },
  {
    path: 'auth',
    loadComponent: () => import('./pages/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    // No authGuard: must stay reachable while signed out.
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/forgot-password/forgot-password.page').then(
        (m) => m.ForgotPasswordPage
      ),
  },
  {
    // No authGuard: this is the `continueUrl` Firebase redirects to once
    // the hosted reset widget has finished.
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/reset-password/reset-password.page').then(
        (m) => m.ResetPasswordPage
      ),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
    canActivate: [authGuard],
  },
  {
    path: 'menu',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard-overview',
    loadComponent: () => import('./pages/dashboard-overview/dashboard-overview.page').then((m) => m.DashboardOverviewPage),
    canActivate: [authGuard],
  },
];
