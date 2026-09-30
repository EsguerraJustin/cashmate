import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { onAuthStateChanged } from 'firebase/auth';
import { FIREBASE_AUTH } from '../core/firebase.tokens';

export const authGuard: CanActivateFn = ():
  | boolean
  | UrlTree
  | Observable<boolean | UrlTree> => {
  const auth = inject(FIREBASE_AUTH);
  const router = inject(Router);

  // Fast path for already-signed-in users (avoids async flicker).
  if (auth.currentUser) {
    return true;
  }

  return new Observable<boolean | UrlTree>((subscriber) => {
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        subscriber.next(
          user ? true : router.createUrlTree(['/welcome'])
        );
        subscriber.complete();
      },
      () => {
        subscriber.next(router.createUrlTree(['/welcome']));
        subscriber.complete();
      }
    );
    return () => unsub();
  });
};
