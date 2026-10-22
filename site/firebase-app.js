import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  sendPasswordResetEmail,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  getDocFromServer, 
  setDoc, 
  deleteDoc, 
  collection, 
  query, 
  onSnapshot, 
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

let app, auth, db, config;

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
      tenantId: auth?.currentUser?.tenantId || null,
      providerInfo: auth?.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function initFirebase() {
  if (app) return { app, auth, db };
  
  try {
    const res = await fetch('/firebase-applet-config.json');
    if (!res.ok) throw new Error('Could not load firebase-applet-config.json');
    config = await res.json();
    
    app = initializeApp(config);
    auth = getAuth(app);
    // CRITICAL: The app will break without passing firestoreDatabaseId
    db = getFirestore(app, config.firestoreDatabaseId);

    // Validate connection to Firestore on boot
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.warn("Please check your Firebase configuration.");
      }
    }

    return { app, auth, db };
  } catch (err) {
    console.error('Failed to init Firebase:', err);
    throw err;
  }
}

export function getFirebaseAuth() {
  return auth;
}

export function getFirebaseDb() {
  return db;
}

export async function syncUserProfile(user) {
  if (!user || !db) return;
  const userRef = doc(db, 'users', user.uid);
  try {
    const existing = await getDoc(userRef);
    if (!existing.exists()) {
      await setDoc(userRef, {
        id: user.uid,
        email: user.email || 'user@feedpulse.ai',
        displayName: user.displayName || user.email?.split('@')[0] || 'Utilisateur',
        photoUrl: user.photoURL || '',
        role: 'user',
        preferredLanguage: 'fr',
        createdAt: serverTimestamp()
      });
    } else {
      await setDoc(userRef, {
        displayName: user.displayName || existing.data().displayName || 'Utilisateur',
        photoUrl: user.photoURL || existing.data().photoUrl || '',
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}

export async function signInGoogle() {
  await initFirebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  await syncUserProfile(result.user);
  return result.user;
}

export async function signInEmail(email, password) {
  await initFirebase();
  const result = await signInWithEmailAndPassword(auth, email, password);
  await syncUserProfile(result.user);
  return result.user;
}

export async function signUpEmail(email, password, displayName) {
  await initFirebase();
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(result.user, { displayName });
  }
  await syncUserProfile(result.user);
  return result.user;
}

export async function biometricOrDemoSignIn() {
  await initFirebase();
  // Quick convenient sign-in for users testing Face ID or Demo
  const demoEmail = 'marie.curie@techpulse.fr';
  const demoPass = 'FeedPulseDemo2026!';
  try {
    return await signInEmail(demoEmail, demoPass);
  } catch (err) {
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      return await signUpEmail(demoEmail, demoPass, 'Marie Curie (Face ID)');
    }
    throw err;
  }
}

export async function resetPassword(email) {
  await initFirebase();
  return await sendPasswordResetEmail(auth, email);
}

export async function logOut() {
  if (auth) {
    await signOut(auth);
  }
}

export async function addFavorite(article) {
  if (!auth?.currentUser || !db) throw new Error('Non connecté');
  const userId = auth.currentUser.uid;
  const favoriteId = article.id || `fav-${Date.now()}`;
  const path = `users/${userId}/favorites/${favoriteId}`;
  try {
    await setDoc(doc(db, 'users', userId, 'favorites', favoriteId), {
      id: favoriteId,
      userId: userId,
      articleId: article.id,
      articleTitle: (article.title || '').slice(0, 256),
      category: (article.category || 'Modèles').slice(0, 64),
      sourceName: (article.sourceName || 'FeedPulse').slice(0, 128),
      sourceUrl: (article.sourceUrl || '').slice(0, 512),
      publishedAt: article.publishedAt || new Date().toISOString(),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeFavorite(favoriteId) {
  if (!auth?.currentUser || !db) throw new Error('Non connecté');
  const userId = auth.currentUser.uid;
  const path = `users/${userId}/favorites/${favoriteId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'favorites', favoriteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeFavorites(callback) {
  if (!auth?.currentUser || !db) return () => {};
  const userId = auth.currentUser.uid;
  const path = `users/${userId}/favorites`;
  const q = query(collection(db, 'users', userId, 'favorites'));
  
  return onSnapshot(q, (snapshot) => {
    const favorites = [];
    snapshot.forEach(docSnap => {
      favorites.push({ id: docSnap.id, ...docSnap.data() });
    });
    callback(favorites);
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, path);
  });
}

export async function saveUserPreferences(preferences) {
  if (!auth?.currentUser || !db) throw new Error('Non connecté');
  const userId = auth.currentUser.uid;
  const path = `users/${userId}`;
  try {
    await setDoc(doc(db, 'users', userId), {
      preferences,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function getUserPreferences() {
  if (!auth?.currentUser || !db) return null;
  const userId = auth.currentUser.uid;
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    return snap.exists() ? snap.data().preferences : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateUserProfileName(newName) {
  if (!auth?.currentUser || !db) return false;
  const user = auth.currentUser;
  try {
    await updateProfile(user, { displayName: newName });
    await setDoc(doc(db, 'users', user.uid), {
      displayName: newName,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    return false;
  }
}


