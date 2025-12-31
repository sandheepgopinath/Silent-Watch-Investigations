// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore,
    collectionGroup,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    serverTimestamp,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// TODO: Replace the following with your app's Firebase project configuration
// See: https://firebase.google.com/docs/web/setup#available-libraries
const firebaseConfig = {
    apiKey: "AIzaSyB67DSj3hkk8JcTj2tMQwy6DNvP5YLL7dA",
    authDomain: "studio-3143701674-93ada.firebaseapp.com",
    projectId: "studio-3143701674-93ada",
    storageBucket: "studio-3143701674-93ada.firebasestorage.app",
    messagingSenderId: "551399254011",
    appId: "1:551399254011:web:fd3822a96fe4e2c8808d5e"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { auth, db, googleProvider, doc, getDoc, setDoc, updateDoc, serverTimestamp, arrayUnion };

// Login Function
export async function loginWithEmail(email, password) {
    // Test User Bypass
    if (email === "jane@sw.com" && password === "admin12") {
        console.log("Test Login Bypass for Jane");
        return {
            success: true,
            user: {
                uid: "test-user-jane-id",
                email: "jane@sw.com",
                displayName: "Jane Doe",
                emailVerified: true
            }
        };
    }

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, user: userCredential.user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Google Login Function
export async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        return { success: true, user: result.user };
    } catch (error) {
        console.error("Google Sign-In Error:", error.code, error.message);
        return { success: false, error: error.message };
    }
}

// Register Function
export async function registerUser(email, password, name, phone) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Generate Random Investigator Code (5 chars)
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();

        // 1. Write parent User document with Code
        await setDoc(doc(db, "users", user.uid), {
            investigatorCode: code,
            createdAt: serverTimestamp()
        }, { merge: true });

        // 2. Write Profile in Subcollection
        await setDoc(doc(db, "users", user.uid, "investigatorProfile", user.uid), {
            name: name,
            email: email,
            phone: phone,
            userId: user.uid,
            id: user.uid, // As per screenshot
            createdAt: serverTimestamp()
        });

        return { success: true, user: user };
    } catch (error) {
        console.error("Registration Error", error);
        return { success: false, error: error.message };
    }
}

// Logout Function
export async function logoutUser() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
        return { success: true };
    } catch (error) {
        console.error("Logout error", error);
        return { success: false, error: error };
    }
}

// Auth State Observer
export function monitorAuthState(onUser, onNoUser) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            onUser(user);
        } else {
            onNoUser();
        }
    });
}
