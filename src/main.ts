import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import {
  FIREBASE_APP,
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
} from './app/core/firebase.tokens';

bootstrapApplication(AppComponent, {
  providers: [
    // Explicit, though it is already the default in Angular 22. `angular.json`
    // ships no `zone.js`, so this app is zoneless: change detection is driven
    // by signals and template listeners only. Firebase snapshots are delivered
    // outside that scheduler, so every async-backed value in this app is a
    // signal — see the reactive-state notes in the page components.
    provideZonelessChangeDetection(),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    {
      provide: FIREBASE_APP,
      useFactory: () => initializeApp(environment.firebase),
    },
    {
      provide: FIREBASE_AUTH,
      useFactory: (app: FirebaseApp) => getAuth(app),
      deps: [FIREBASE_APP],
    },
    {
      provide: FIREBASE_FIRESTORE,
      // Persistent cache so a cold start renders the last-known data
      // immediately instead of emitting an empty snapshot first — that empty
      // emission is what briefly showed "no categories" on every refresh.
      useFactory: (app: FirebaseApp) =>
        initializeFirestore(app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        }),
      deps: [FIREBASE_APP],
    },
  ],
});
