const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');
require('dotenv').config();

let cert = require('./firebase-credentials.json');
admin.initializeApp({ credential: admin.credential.cert(cert) });
const db = getFirestore();

async function test() {
    const docRef = db.collection('media_cache').doc('test1234');
    
    // Simulating Request 1
    await db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        if (!doc.exists) {
            t.set(docRef, { 
                files: ['file1'], 
                updatedAt: FieldValue.serverTimestamp() 
            });
        }
    });

    console.log("Request 1 done");

    // Simulating Request 2
    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            if (doc.exists) {
                t.update(docRef, {
                    files: FieldValue.arrayUnion('file2'),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        });
        console.log("Request 2 done");
    } catch (e) {
        console.error("Request 2 Error:", e);
    }
    
    const finalDoc = await docRef.get();
    console.log("Final files:", finalDoc.data().files);
    
    await docRef.delete();
}

test();
