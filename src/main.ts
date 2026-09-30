import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import {
  FIREBASE_APP,
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
} from './app/core/firebase.tokens';

bootstrapApplication(AppComponent, {
  providers: [
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
      useFactory: (app: FirebaseApp) => getFirestore(app),
      deps: [FIREBASE_APP],
    },
  ],
});
