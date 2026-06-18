import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  initializeAuth, 
  browserLocalPersistence, 
  browserSessionPersistence, 
  inMemoryPersistence, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut 
} from 'firebase/auth';
import { initializeFirestore, doc, getDoc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
} as any, firebaseConfig.firestoreDatabaseId); // Using the correct databaseId and enabling long-polling for reliable connections in sandboxed iframes

const determineAuth = () => {
  if (typeof window === 'undefined') {
    return getAuth(app);
  }

  // Check if we can safely use local storage
  let hasStorage = false;
  try {
    localStorage.setItem('__firebase_test__', '1');
    localStorage.removeItem('__firebase_test__');
    hasStorage = true;
  } catch (e) {
    console.warn("Storage access is restricted in this environment. Falling back to memory/session persistence.");
  }

  const isIframe = window.self !== window.top;

  if (isIframe || !hasStorage) {
    try {
      // In sandboxed frames (like Google AI Studio preview), indexedDB/localStorage can fail.
      // We initialize with session and memory persistence bypasses the buggy IndexedDB check.
      return initializeAuth(app, {
        persistence: [browserSessionPersistence, inMemoryPersistence]
      });
    } catch (e) {
      console.warn("initializeAuth with session persistence fallback failed:", e);
      try {
        return initializeAuth(app, {
          persistence: inMemoryPersistence
        });
      } catch (err) {
        console.warn("initializeAuth failed entirely, using standard getAuth registry fallback:", err);
        return getAuth(app);
      }
    }
  }

  try {
    // Normal environment, try standard getAuth first
    return getAuth(app);
  } catch (e) {
    console.warn("Standard getAuth failed, initializing with full persistence array fallback:", e);
    try {
      return initializeAuth(app, {
        persistence: [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence]
      });
    } catch (err) {
      try {
        return initializeAuth(app, {
          persistence: inMemoryPersistence
        });
      } catch (finalErr) {
        return getAuth(app);
      }
    }
  }
};

export const auth = determineAuth();
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('[Firestore Security Error]: ', JSON.stringify(errInfo, null, 2));
  throw new Error(JSON.stringify(errInfo));
}

// Connection Validation checklist as requested by the skill
async function testConnection() {
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout checking connection")), 3000)
    );
    await Promise.race([
      getDocFromServer(doc(db, 'test', 'connection')),
      timeoutPromise
    ]);
    console.log("Firestore backend connected.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Please check your Firebase configuration: Client appears to be offline.");
    } else {
      console.warn("Firestore offline mode active: backend connection test bypassed/timed out.");
    }
  }
}
testConnection();
