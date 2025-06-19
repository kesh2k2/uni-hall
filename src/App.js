/* global __app_id, __firebase_config, __initial_auth_token */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, onSnapshot, collection, getDocs, addDoc, query, orderBy, limit } from 'firebase/firestore';

// --- Firebase Configuration ---
const YOUR_FIREBASE_CONFIG = {
  apiKey: "AIzaSyClLtj-z8vU2N5KZSeRKGViWnjHW7MtMeM",
  authDomain: "university-halls.firebaseapp.com",
  projectId: "university-halls",
  storageBucket: "university-halls.firebasestorage.app",
  messagingSenderId: "261428554258",
  appId: "1:261428554258:web:cceaaa4b8ddfbad12a86cb"
};

const appId = typeof __app_id !== 'undefined' ? __app_id : YOUR_FIREBASE_CONFIG.projectId;
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : YOUR_FIREBASE_CONFIG;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Main App Component ---
function App() {
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState('Loading...');
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [lectureHalls, setLectureHalls] = useState({});
    const [records, setRecords] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [activeTab, setActiveTab] = useState('map');
    const [selectedHall, setSelectedHall] = useState(null);
    const [showHallDetailsModal, setShowHallDetailsModal] = useState(false);
    const [showCleaningModal, setShowCleaningModal] = useState(false);
    const [requests, setRequests] = useState([]); // Stores local requests for display

    // Effect for Firebase Initialization
    useEffect(() => {
        const initFirebase = async () => {
            try {
                const app = initializeApp(firebaseConfig);
                const firestoreDb = getFirestore(app);
                const firebaseAuth = getAuth(app);
                setDb(firestoreDb);

                onAuthStateChanged(firebaseAuth, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                    } else {
                        if (initialAuthToken) {
                            await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        } else {
                            await signInAnonymously(firebaseAuth);
                        }
                    }
                    setIsAuthReady(true);
                });
            } catch (error) {
                console.error("Error initializing Firebase:", error);
            }
        };
        initFirebase();
        // Set the document title when the component mounts
        document.title = "University Hall Management System";
    }, []);

    // Effect for setting up Firestore listeners
    useEffect(() => {
        if (!db || !isAuthReady) return;

        // One-time check to seed initial data
        const hallsCollectionRef = collection(db, `artifacts/${appId}/public/data/lecture_halls`);
        const checkAndCreateInitialData = async () => {
            const snapshot = await getDocs(hallsCollectionRef);
            if (snapshot.empty) {
                console.log("Creating initial data...");
                const initialHalls = Array.from({ length: 16 }, (_, i) => ({
                    id: `LH-${String(i + 1).padStart(2, '0')}`, name: `Hall ${i + 1}`, status: 'free',
                    facilities: { chairsAvailable: 100, smartBoard: true, whiteBoard: true, pensAvailable: true, acMachines: Array(Math.floor(Math.random() * 2) + 2).fill(0).map(() => ({ id: crypto.randomUUID(), working: Math.random() > 0.15 })) },
                    currentLecture: null,
                    // IMPORTANT CHANGE: Initially clean, cleanedAt is now current date for proper daily reset
                    cleaningStatus: { isClean: true, cleanedBy: 'System', cleanedAt: new Date(), employeeId: 'AUTO' },
                    schedule: [], attendanceRecords: [],
                }));
                for (const hall of initialHalls) { await setDoc(doc(hallsCollectionRef, hall.id), hall); }
                await addDoc(collection(db, `artifacts/${appId}/public/data/announcements`), { text: 'Welcome to the new University Hall Management System!', timestamp: new Date(), author: 'Admin' });
            }
        };
        checkAndCreateInitialData();

        // Listeners for halls, records, and announcements
        const hallsUnsubscribe = onSnapshot(hallsCollectionRef, snapshot => {
            const fetchedHalls = {};
            const updates = []; // To batch updates for Firestore

            snapshot.docs.forEach(docSnap => {
                const hallData = { id: docSnap.id, ...docSnap.data() };
                let currentHallState = { ...hallData };
                let needsUpdate = false;
                let updatePayload = {};

                // Logic to make halls dirty every morning
                if (currentHallState.cleaningStatus.isClean && currentHallState.cleaningStatus.cleanedAt) {
                    const cleanedDate = new Date(currentHallState.cleaningStatus.cleanedAt.toDate ? currentHallState.cleaningStatus.cleanedAt.toDate() : currentHallState.cleaningStatus.cleanedAt);
                    const today = new Date();

                    // Check if cleaned date is NOT today
                    if (cleanedDate.getDate() !== today.getDate() ||
                        cleanedDate.getMonth() !== today.getMonth() ||
                        cleanedDate.getFullYear() !== today.getFullYear()) {
                        
                        currentHallState.cleaningStatus = {
                            isClean: false,
                            cleanedBy: '',
                            cleanedAt: null, // Reset cleanedAt to null once dirty
                            employeeId: '',
                        };
                        updatePayload.cleaningStatus = currentHallState.cleaningStatus;
                        needsUpdate = true;
                    }
                }

                // If any changes were detected, add to updates batch
                if (needsUpdate) {
                    updates.push(updateDoc(doc(db, `artifacts/${appId}/public/data/lecture_halls/${currentHallState.id}`), updatePayload));
                }

                fetchedHalls[currentHallState.id] = currentHallState; // Use currentHallState (potentially updated) for local state
            });

            // Apply all batched updates to Firestore
            if (updates.length > 0) {
                Promise.all(updates)
                    .then(() => console.log("Batch updates for cleaning status complete."))
                    .catch(error => console.error("Error during batch updates:", error));
            }
            
            setLectureHalls(fetchedHalls);
        });

        const recordsQuery = query(collection(db, `artifacts/${appId}/public/data/records`), orderBy("timestamp", "desc"), limit(100));
        const recordsUnsubscribe = onSnapshot(recordsQuery, snapshot => {
            setRecords(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        const announcementsQuery = query(collection(db, `artifacts/${appId}/public/data/announcements`), orderBy("timestamp", "desc"), limit(5));
        const announcementsUnsubscribe = onSnapshot(announcementsQuery, snapshot => {
            setAnnouncements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => { hallsUnsubscribe(); recordsUnsubscribe(); announcementsUnsubscribe(); };
    }, [db, isAuthReady, appId]); // Added appId to dependencies

    // Centralized function for adding records to Firestore
    const addRecord = useCallback(async (type, hallName, message, details = {}) => {
        if (!db) return;
        try {
            await addDoc(collection(db, `artifacts/${appId}/public/data/records`), {
                type, hallName, message, details, timestamp: new Date(), user: userId.substring(0, 8)
            });
        } catch (error) { console.error("Error adding record:", error); }
    }, [db, userId, appId]);
    
    // Modal Control Handlers
    const handleOpenHallDetails = useCallback((hallId) => { setSelectedHall(lectureHalls[hallId]); setShowHallDetailsModal(true); }, [lectureHalls]);
    const handleCloseHallDetails = useCallback(() => setShowHallDetailsModal(false), []);
    const handleOpenCleaningModal = useCallback((hallId) => { setSelectedHall(lectureHalls[hallId]); setShowCleaningModal(true); }, [lectureHalls]);
    const handleCloseCleaningModal = useCallback(() => setShowCleaningModal(false), []);

    // Firestore Update Handlers
    const updateHallInFirestore = useCallback(async (hallId, updateData) => {
        if (!db) return;
        try { await updateDoc(doc(db, `artifacts/${appId}/public/data/lecture_halls/${hallId}`), updateData); }
        catch (error) { console.error(`Error updating hall ${hallId}:`, error); }
    }, [db, appId]);
    
    // **FIXED**: This function now correctly adds a record after updating the cleaning status.
    const handleUpdateCleaningStatus = useCallback(async (hallId, cleanerDetails) => {
        const hall = lectureHalls[hallId];
        if (!hall || !db) return;
        const updatedCleaningStatus = { isClean: true, cleanedBy: cleanerDetails.cleanerName, cleanedAt: new Date(), employeeId: cleanerDetails.employeeId, };
        await updateHallInFirestore(hall.id, { cleaningStatus: updatedCleaningStatus, status: 'free' });
        addRecord('Cleaning', hall.name, `Cleaned by ${cleanerDetails.cleanerName}.`, { notes: cleanerDetails.cleaningNotes });
        handleCloseCleaningModal();
    }, [lectureHalls, db, updateHallInFirestore, addRecord, handleCloseCleaningModal]);

    // Handler for saving lecture details (from HallDetailsModal)
    const handleSaveLecture = useCallback(async (hallId, lectureData) => {
        const hall = lectureHalls[hallId];
        if (!hall || !db) return;

        const trimmedLectureName = lectureData.lectureName.trim();
        const trimmedLecturerName = lectureData.lecturerName.trim();
        const trimmedSubjectCodes = lectureData.subjectCodes.trim();

        if (!trimmedLectureName || !trimmedLecturerName || !trimmedSubjectCodes || !lectureData.durationHours || !lectureData.startTime) {
            console.error('All lecture details are required.'); // In a real app, show a user-friendly error
            return;
        }

        const startTime = new Date(lectureData.startTime);
        const endTime = new Date(startTime.getTime() + parseFloat(lectureData.durationHours) * 60 * 60 * 1000);

        const updatedData = {
            status: 'occupied',
            currentLecture: {
                name: trimmedLectureName,
                lecturer: trimmedLecturerName,
                subjectCodes: trimmedSubjectCodes,
                studentsCount: parseInt(lectureData.studentsCount) || 0,
                durationHours: parseFloat(lectureData.durationHours),
                startTime: startTime,
                endTime: endTime,
                isScheduledLecture: false, // Explicitly mark as not scheduled when added manually
            },
            // IMPORTANT CHANGE: Do NOT mark dirty immediately on occupation.
            // Hall remains clean until next morning's daily reset.
            // cleaningStatus: { ...hall.cleaningStatus, isClean: false },
        };
        await updateHallInFirestore(hallId, updatedData);
        addRecord('Lecture Start', hall.name, `Started: "${trimmedLectureName}" by ${trimmedLecturerName}.`);
        handleCloseHallDetails();
    }, [lectureHalls, db, updateHallInFirestore, addRecord, handleCloseHallDetails]);

    // Handler for marking a hall as free (from HallDetailsModal)
    const handleMarkHallFree = useCallback(async (hallId) => {
        const hall = lectureHalls[hallId];
        if (!hall || !db) return;

        const lectureName = hall.currentLecture?.name || 'Unknown Lecture';

        const updatedData = {
            status: 'free',
            currentLecture: null,
            // IMPORTANT CHANGE: Do NOT mark dirty immediately on marking free.
            // Hall remains clean until next morning's daily reset.
            // cleaningStatus: { ...hall.cleaningStatus, isClean: false },
        };
        await updateHallInFirestore(hallId, updatedData);
        addRecord('Lecture End', hall.name, `Ended: "${lectureName}". Hall is now free.`);
        handleCloseHallDetails();
    }, [lectureHalls, db, updateHallInFirestore, addRecord, handleCloseHallDetails]);

    // Handler for marking scheduled lecture as held (from HallDetailsModal)
    const handleMarkScheduledLecture = useCallback(async (hallId, scheduledEntry) => {
        const hall = lectureHalls[hallId];
        if (!hall || !db || !scheduledEntry) return;

        const now = new Date();
        const [hours, minutes] = scheduledEntry.lecture.startTime.split(':').map(Number);
        const actualStartTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
        const endTime = new Date(actualStartTime.getTime() + scheduledEntry.lecture.durationHours * 60 * 60 * 1000);

        const updatedData = {
            status: 'occupied',
            currentLecture: {
                name: scheduledEntry.lecture.name,
                lecturer: scheduledEntry.lecture.lecturer,
                subjectCodes: scheduledEntry.lecture.subjectCodes,
                durationHours: scheduledEntry.lecture.durationHours,
                studentsCount: 0, // Default for scheduled, can be updated later
                startTime: actualStartTime,
                endTime: endTime,
                isScheduledLecture: true,
            },
            // IMPORTANT CHANGE: Do NOT mark dirty immediately.
            // cleaningStatus: { ...hall.cleaningStatus, isClean: false },
        };
        await updateHallInFirestore(hallId, updatedData);
        addRecord('Scheduled Lecture Start', hall.name, `Scheduled lecture "${scheduledEntry.lecture.name}" started.`);
        handleCloseHallDetails();
    }, [lectureHalls, db, updateHallInFirestore, addRecord, handleCloseHallDetails]);

    // Handler for marking scheduled lecture as skipped (from HallDetailsModal)
    const handleMarkScheduledSkipped = useCallback(async (hallId, scheduledEntry) => {
        const hall = lectureHalls[hallId];
        if (!hall || !db || !scheduledEntry) return;

        // Add to requests
        setRequests(prev => [...prev, {
            hall: hall.name,
            type: 'Scheduled Lecture Canceled',
            message: `Scheduled lecture "${scheduledEntry.lecture.name}" in ${hall.name} was skipped/canceled.`,
            time: new Date().toLocaleString(),
            department: 'Academic Affairs',
            emailRecipient: 'academic.head@example.com' // Example recipient
        }]);

        // Mark the hall as free (if it was occupied by this lecture or just to clear current state)
        if (hall.currentLecture && hall.currentLecture.isScheduledLecture && hall.currentLecture.name === scheduledEntry.lecture.name) {
            await handleMarkHallFree(hallId); // Use existing function to clear lecture and mark dirty
        } else {
             // If not currently occupied by this specific scheduled lecture, just record the skip.
             addRecord('Scheduled Lecture Skipped', hall.name, `Scheduled lecture "${scheduledEntry.lecture.name}" was skipped.`);
             handleCloseHallDetails(); // Close the modal
        }

    }, [handleMarkHallFree, handleCloseHallDetails, lectureHalls, addRecord, setRequests]);


    // Handler for sending an additional request or special request
    const handleSendRequest = useCallback(async (hallId, message, type = 'General Request', department = 'Administration', emailRecipient = null) => {
        const hall = lectureHalls[hallId];
        if (!hall || !message.trim()) return;

        const requestEntry = {
            hall: hall.name,
            type: type,
            message: message,
            time: new Date().toLocaleString(),
            department: department,
            emailRecipient: emailRecipient // Pass recipient for special requests
        };

        setRequests(prev => [...prev, requestEntry]);

        // Also add to Firestore records for persistence
        addRecord(type, hall.name, message, { department, emailRecipient });

        console.log(`Request sent: ${type} - ${message}` + (emailRecipient ? ` (Email to: ${emailRecipient})` : ''));

    }, [lectureHalls, addRecord, setRequests]);


    return (
        <div className="animated-bg min-h-screen font-sans text-gray-800 p-2 sm:p-4">
            <header className="bg-white/70 backdrop-blur-lg p-4 shadow-lg rounded-2xl mb-6 sticky top-2 sm:top-4 z-20 border border-white/30">
                <h1 className="text-2xl sm:text-3xl font-bold text-indigo-800 mb-2 text-center">
                    University Hall Management
                </h1>
                <nav className="flex justify-center flex-wrap gap-2 sm:gap-3 mt-4">
                    {['map', 'cleaning', 'records'].map(tab => (
                         <button key={tab}
                            className={`px-4 py-2 rounded-full font-semibold transition-all duration-300 transform shadow-md hover:shadow-lg hover:scale-105 active:scale-95 ${activeTab === tab ? 'bg-indigo-600 text-white' : 'bg-white/80 text-gray-700 hover:bg-white'}`}
                            onClick={() => setActiveTab(tab)}>
                            {tab === 'map' && '🗺️ Dashboard'}
                            {tab === 'cleaning' && '🧹 Cleaning'}
                            {tab === 'records' && '📊 Records'}
                        </button>
                    ))}
                </nav>
            </header>

            <main className="max-w-7xl mx-auto px-0">
                {activeTab === 'map' && <DashboardView lectureHalls={lectureHalls} onHallClick={handleOpenHallDetails} announcements={announcements} requests={requests} />}
                {activeTab === 'cleaning' && <CleaningOverview lectureHalls={lectureHalls} onUpdateCleaning={handleOpenCleaningModal} />}
                {activeTab === 'records' && <RecordsView records={records} />}
            </main>

            {showHallDetailsModal && selectedHall && (
                <HallDetailsModal hall={selectedHall} onClose={handleCloseHallDetails}
                    onStartCleaning={() => { handleCloseHallDetails(); handleOpenCleaningModal(selectedHall.id); }}
                    updateHallInFirestore={updateHallInFirestore} addRecord={addRecord}
                    onSaveLecture={handleSaveLecture} onMarkHallFree={handleMarkHallFree}
                    onMarkScheduledLecture={handleMarkScheduledLecture}
                    onMarkScheduledSkipped={handleMarkScheduledSkipped}
                    onSendRequest={handleSendRequest} // Unified request sender
                />
            )}
            {showCleaningModal && selectedHall && <CleaningModal hall={selectedHall} onClose={handleCloseCleaningModal} onCompleteCleaning={handleUpdateCleaningStatus} />}
        </div>
    );
}

// --- Reusable UI Components & Constants ---
const baseButtonClasses = "px-5 py-2.5 rounded-full font-semibold shadow-md transform transition-all duration-200 ease-in-out hover:scale-105 hover:shadow-lg active:scale-95 active:shadow-inner focus:outline-none focus:ring-2 focus:ring-offset-2";
const buttonStyles = {
    primary: `bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500`,
    secondary: `bg-gray-200 text-gray-800 hover:bg-gray-300 focus:ring-gray-400`,
    success: `bg-green-500 text-white hover:bg-green-600 focus:ring-green-500`,
    danger: `bg-red-500 text-white hover:bg-red-600 focus:ring-red-500`,
    info: `bg-blue-500 text-white hover:bg-blue-600 focus:ring-blue-500`,
    dark: `bg-gray-700 text-white hover:bg-gray-800 focus:ring-gray-600`,
};
const formInputClasses = "w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition";

// --- New and Revamped Components ---

function ImageSlider() {
    const images = [
        "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?q=80&w=2070&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=2070&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1607237138185-e894ee3bf3d2?q=80&w=1974&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1622037040293-9c8844119969?q=80&w=1932&auto=format&fit=crop",
    ];
    return (
        <div className="relative w-full h-48 md:h-64 rounded-xl overflow-hidden shadow-2xl mb-6">
            <div className="absolute inset-0 bg-black/30 z-10"></div>
            <div className="w-full h-full flex image-slider-animation">
                {images.map(src => <img key={src} src={src} className="w-full h-full object-cover flex-shrink-0" alt="University campus" />)}
            </div>
            <div className="absolute inset-0 z-20 flex flex-col justify-center items-center text-white p-4">
                <h2 className="text-3xl md:text-4xl font-extrabold text-center shadow-lg">Real-Time Hall Status</h2>
                <p className="mt-2 text-lg text-center opacity-90">Instant insights at your fingertips</p>
            </div>
        </div>
    );
}

function DashboardView({ lectureHalls, onHallClick, announcements, requests }) { // Added requests
    const getHallNumber = (hallName) => { const match = hallName.match(/\d+/); return match ? parseInt(match[0], 10) : Infinity; };

    return (
        <>
            <ImageSlider />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <section className="lg:col-span-2 bg-white/70 backdrop-blur-lg rounded-2xl shadow-lg p-4 sm:p-6 border border-white/30">
                    <h2 className="text-xl sm:text-2xl font-bold text-indigo-800 mb-4 text-center">Hall Overview</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {Object.values(lectureHalls).sort((a, b) => getHallNumber(a.name) - getHallNumber(b.name)).map(hall => {
                            const isOccupied = hall.status === 'occupied';
                            const isCleaning = hall.status === 'cleaning'; // New status
                            const isClean = hall.cleaningStatus.isClean;
                            let hallBgClass = '';
                            let hallTextClass = 'text-white'; // Default for occupied/cleaning
                            if (isOccupied) {
                                hallBgClass = 'bg-red-500/80';
                            } else if (isCleaning) {
                                hallBgClass = 'bg-blue-500/80';
                            } else {
                                hallBgClass = 'bg-green-500/80';
                                hallTextClass = 'text-gray-800'; // For free halls
                            }

                            return (
                                <div key={hall.id} onClick={() => onHallClick(hall.id)}
                                    className={`p-3 rounded-xl shadow-md cursor-pointer transform transition-all duration-300 ease-in-out hover:-translate-y-1 hover:shadow-xl relative overflow-hidden ${hallBgClass} ${hallTextClass}`}>
                                    <div className="text-md font-bold text-center">{hall.name}</div>
                                    <div className="text-xs capitalize font-semibold text-center mt-1">
                                        {isOccupied ? 'Occupied' : isCleaning ? 'Cleaning' : 'Available'}
                                    </div>
                                    <div className={`absolute bottom-1.5 right-1.5 text-xs font-bold px-2 py-0.5 rounded-full ${isClean ? 'bg-green-100 text-green-900' : 'bg-yellow-200 text-yellow-900'}`}>
                                        {isClean ? 'Clean' : 'Dirty'}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </section>
                <section className="bg-white/70 backdrop-blur-lg rounded-2xl shadow-lg p-4 sm:p-6 border border-white/30">
                    <h2 className="text-xl sm:text-2xl font-bold text-indigo-800 mb-3 text-center">📢 Announcements</h2>
                    <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                        {announcements.length > 0 ? announcements.map(ann => (
                            <div key={ann.id} className="bg-indigo-50/80 p-3 rounded-lg border-l-4 border-indigo-400 text-sm">
                                <p className="text-gray-800">{ann.text}</p>
                                <p className="text-xs text-gray-500 mt-1 text-right">{new Date(ann.timestamp.toDate()).toLocaleString()}</p>
                            </div>
                        )) : <p className="text-center text-gray-500 py-4">No recent announcements.</p>}
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-indigo-800 mt-6 mb-3 text-center">📋 Recent Requests</h2>
                    <RequestsList requests={requests} /> {/* Display local requests */}
                </section>
            </div>
        </>
    );
}

/**
 * RequestsList Component: Displays a list of recent requests.
 * @param {object} props - Component props.
 * @param {array} props.requests - Array of recent requests to display.
 */
function RequestsList({ requests }) {
    if (requests.length === 0) {
        return (
            <p className="text-center text-gray-600 text-lg py-4">No pending requests.</p>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
            {requests.slice(-5).reverse().map((request, index) => ( // Display last 5 requests
                <div key={index} className="bg-gray-50 p-4 rounded-lg shadow-sm border-l-4 border-indigo-400">
                    <p className="text-md font-semibold text-gray-800">
                        {request.hall} - {request.type}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">{request.message}</p>
                    <p className="text-xs text-gray-500 mt-2 text-right">
                        📅 {request.time} | 🏢 {request.department}
                        {request.emailRecipient && <span className="ml-2 text-blue-700">📧 {request.emailRecipient}</span>}
                    </p>
                </div>
            ))}
        </div>
    );
}

function CleaningOverview({ lectureHalls, onUpdateCleaning }) {
     return (
        <section className="bg-white/70 backdrop-blur-lg rounded-2xl shadow-lg p-4 sm:p-6 border border-white/30">
            <h2 className="text-xl sm:text-2xl font-bold text-indigo-800 mb-4 text-center">🧹 Cleaning Management</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Object.values(lectureHalls).sort((a,b) => a.name.localeCompare(b.name)).map(hall => {
                    const statusClass = hall.cleaningStatus.isClean ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800';
                    return (
                        <div key={hall.id} className="bg-white/80 p-4 rounded-xl shadow-md border text-center flex flex-col justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-gray-800 mb-2">{hall.name}</h3>
                                <div className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${statusClass}`}>{hall.cleaningStatus.isClean ? 'Clean' : 'Needs Cleaning'}</div>
                                {/* Added check for hall.cleaningStatus.cleanedAt before calling toDate() */}
                                <p className="text-gray-500 mt-2 text-xs">Last Clean: {hall.cleaningStatus.cleanedAt ? new Date(hall.cleaningStatus.cleanedAt.toDate ? hall.cleaningStatus.cleanedAt.toDate() : hall.cleaningStatus.cleanedAt).toLocaleString() : 'N/A'}</p>
                            </div>
                            <button className={`${baseButtonClasses} ${buttonStyles.primary} w-full mt-3 !py-1.5 !text-sm`} onClick={() => onUpdateCleaning(hall.id)}>Update Status</button>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

function RecordsView({ records }) {
     return (
        <section className="bg-white/70 backdrop-blur-lg rounded-2xl shadow-lg p-4 sm:p-6 border border-white/30">
            <h2 className="text-xl sm:text-2xl font-bold text-indigo-800 mb-4 text-center">📊 Activity Records</h2>
            <div className="max-h-[65vh] overflow-y-auto">
                <table className="w-full text-sm text-left text-gray-600">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-200/50 sticky top-0 z-10 backdrop-blur-sm">
                        <tr>
                            <th scope="col" className="px-4 py-2">Timestamp</th>
                            <th scope="col" className="px-4 py-2">Type</th>
                            <th scope="col" className="px-4 py-2">Hall</th>
                            <th scope="col" className="px-4 py-2">Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        {records.map(record => (
                            <tr key={record.id} className="bg-white/60 border-b border-gray-200/80 hover:bg-gray-50/80">
                                {/* Added check for record.timestamp before calling toDate() */}
                                <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">{record.timestamp ? new Date(record.timestamp.toDate ? record.timestamp.toDate() : record.timestamp).toLocaleString() : 'N/A'}</td>
                                <td className="px-4 py-2"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${record.type === 'Cleaning' ? 'bg-blue-100 text-blue-800' : record.type.includes('Lecture') ? 'bg-purple-100 text-purple-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                    {record.type}
                                    </span>
                                </td>
                                <td className="px-4 py-2">{record.hallName}</td>
                                <td className="px-4 py-2">{record.message}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                 {records.length === 0 && <p className="text-center text-gray-500 py-8">No records found. Activities will be logged here.</p>}
            </div>
        </section>
    );
}

function HallDetailsModal({ hall, onClose, onStartCleaning, updateHallInFirestore, addRecord, onSaveLecture, onMarkHallFree, onMarkScheduledLecture, onMarkScheduledSkipped, onSendRequest }) {
    const [activeDetailTab, setActiveDetailTab] = useState('lectures');
    const [message, setMessage] = useState({ type: '', text: '' }); // For modal-specific messages

    // Lecture form states
    const [lectureName, setLectureName] = useState(hall.currentLecture?.name || '');
    const [lecturerName, setLecturerName] = useState(hall.currentLecture?.lecturer || '');
    const [subjectCodes, setSubjectCodes] = useState(hall.currentLecture?.subjectCodes || '');
    const [studentsCount, setStudentsCount] = useState(hall.currentLecture?.studentsCount || '');
    const [durationHours, setDurationHours] = useState(hall.currentLecture?.durationHours || '');
    const [startTime, setStartTime] = useState(() => {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        return now.toISOString().slice(0, 16);
    });

    // Facility editing states
    const [editableChairsAvailable, setEditableChairsAvailable] = useState(hall.facilities.chairsAvailable);
    const [editableSmartBoard, setEditableSmartBoard] = useState(hall.facilities.smartBoard);
    const [editableWhiteBoard, setEditableWhiteBoard] = useState(hall.facilities.whiteBoard);
    const [editablePensAvailable, setEditablePensAvailable] = useState(hall.facilities.pensAvailable);
    const [editableAcCount, setEditableAcCount] = useState(hall.facilities.acMachines.length);
    const [editableAcMachines, setEditableAcMachines] = useState(hall.facilities.acMachines);

    // Schedule management states
    const [showScheduleEditor, setShowScheduleEditor] = useState(false);
    const [newScheduleDays, setNewScheduleDays] = useState([]);
    const [newScheduleLectureName, setNewScheduleLectureName] = useState('');
    const [newScheduleLecturerName, setNewScheduleLecturerName] = useState('');
    const [newScheduleSubjectCodes, setNewScheduleSubjectCodes] = useState('');
    const [newScheduleDurationHours, setNewScheduleDurationHours] = useState('');
    const [newScheduleStartTime, setNewScheduleStartTime] = useState('08:00');
    const [editingScheduleId, setEditingScheduleId] = useState(null);

    // Attendance states
    const [currentAttendanceInput, setCurrentAttendanceInput] = useState('');
    const [specialRequestNotes, setSpecialRequestNotes] = useState(''); // State for special request email

    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // Update form fields and reset states when selected hall changes
    useEffect(() => {
        setLectureName(hall.currentLecture?.name || '');
        setLecturerName(hall.currentLecture?.lecturer || '');
        setSubjectCodes(hall.currentLecture?.subjectCodes || '');
        setStudentsCount(hall.currentLecture?.studentsCount || '');
        setDurationHours(hall.currentLecture?.durationHours || '');
        setMessage({ type: '', text: '' });
        setSpecialRequestNotes('');
        setCurrentAttendanceInput('');

        if (hall.currentLecture?.startTime) {
            const date = new Date(hall.currentLecture.startTime.toDate ? hall.currentLecture.startTime.toDate() : hall.currentLecture.startTime);
            setStartTime(date.toISOString().slice(0, 16));
        } else {
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            setStartTime(now.toISOString().slice(0, 16));
        }

        setShowScheduleEditor(false);
        setActiveDetailTab('lectures'); // Reset to default tab

        // Facilities reset
        setEditableChairsAvailable(hall.facilities.chairsAvailable);
        setEditableSmartBoard(hall.facilities.smartBoard);
        setEditableWhiteBoard(hall.facilities.whiteBoard);
        setEditablePensAvailable(hall.facilities.pensAvailable);
        setEditableAcMachines(hall.facilities.acMachines || []); // Ensure it's an array
        setEditableAcCount(hall.facilities.acMachines?.length || 0);

        // Schedule form reset
        setNewScheduleLectureName('');
        setNewScheduleLecturerName('');
        setNewScheduleSubjectCodes('');
        setNewScheduleDurationHours('');
        setNewScheduleStartTime('08:00');
        setNewScheduleDays([]);
        setEditingScheduleId(null);

    }, [hall]);

    // Effect to update AC Machines array when editableAcCount changes
    useEffect(() => {
        const currentCount = editableAcMachines.length;
        const targetCount = parseInt(editableAcCount);

        if (isNaN(targetCount) || targetCount < 0) return;

        if (targetCount > currentCount) {
            const newUnitsToAdd = targetCount - currentCount;
            const newAcs = Array(newUnitsToAdd).fill(0).map(() => ({ id: crypto.randomUUID(), working: true }));
            setEditableAcMachines(prev => [...prev, ...newAcs]);
        } else if (targetCount < currentCount) {
            setEditableAcMachines(prev => prev.slice(0, targetCount));
        }
    }, [editableAcCount]);


    const handleSubmitLecture = () => {
        if (!lectureName.trim() || !lecturerName.trim() || !subjectCodes.trim() || !durationHours || !startTime) {
            setMessage({ type: 'error', text: 'Please fill all lecture details (including name, lecturer, subject codes, duration, and start time).' });
            return;
        }
        onSaveLecture(hall.id, { lectureName, lecturerName, subjectCodes, studentsCount, durationHours, startTime });
    };

    /**
     * Handles saving the updated facility details to Firestore.
     */
    const handleSaveFacilities = async () => {
        const updatedFacilities = {
            chairsAvailable: parseInt(editableChairsAvailable) || 0,
            smartBoard: editableSmartBoard,
            whiteBoard: editableWhiteBoard,
            pensAvailable: editablePensAvailable,
            acMachines: editableAcMachines,
        };

        try {
            await updateHallInFirestore(hall.id, { facilities: updatedFacilities });
            setMessage({ type: 'success', text: 'Facility details updated successfully!' });
        } catch (error) {
            console.error("Error updating facilities:", error);
            setMessage({ type: 'error', text: 'Failed to update facility details.' });
        }
    };

    /**
     * Toggles the working status of an individual AC machine in the local state.
     */
    const toggleLocalACStatus = (acId) => {
        setEditableAcMachines(prev =>
            prev.map(ac => ac.id === acId ? { ...ac, working: !ac.working } : ac)
        );
    };

    /**
     * Handles changes to the day checkboxes for scheduling.
     */
    const handleDayCheckboxChange = (day, isChecked) => {
        setNewScheduleDays(prev => {
            if (isChecked) {
                return [...prev, day].sort((a, b) => daysOfWeek.indexOf(a) - daysOfWeek.indexOf(b));
            } else {
                return prev.filter(d => d !== day);
            }
        });
    };

    /**
     * Adds a new scheduled lecture entry to the hall.
     */
    const handleAddScheduleEntry = async () => {
        if (newScheduleDays.length === 0 || !newScheduleLectureName.trim() || !newScheduleLecturerName.trim() || !newScheduleSubjectCodes.trim() || !newScheduleDurationHours || !newScheduleStartTime) {
            setMessage({ type: 'error', text: 'Please fill all new schedule details, including at least one day and a start time.' });
            return;
        }

        const newEntry = {
            scheduleId: crypto.randomUUID(),
            days: newScheduleDays,
            lecture: {
                name: newScheduleLectureName.trim(),
                lecturer: newScheduleLecturerName.trim(),
                subjectCodes: newScheduleSubjectCodes.trim(),
                durationHours: parseFloat(newScheduleDurationHours),
                startTime: newScheduleStartTime,
            },
        };

        const updatedSchedule = [...(hall.schedule || []), newEntry];
        const updatedData = {
            schedule: updatedSchedule,
            isScheduled: true,
        };

        await updateHallInFirestore(hall.id, updatedData);
        setMessage({ type: 'success', text: 'Schedule entry added!' });
        // Clear form
        setNewScheduleLectureName('');
        setNewScheduleLecturerName('');
        setNewScheduleSubjectCodes('');
        setNewScheduleDurationHours('');
        setNewScheduleStartTime('08:00');
        setNewScheduleDays([]);
        setEditingScheduleId(null);
    };

    /**
     * Prepares the form for editing an existing schedule entry.
     */
    const startEditingSchedule = (entry) => {
        setEditingScheduleId(entry.scheduleId);
        setNewScheduleDays(entry.days || []);
        setNewScheduleLectureName(entry.lecture.name);
        setNewScheduleLecturerName(entry.lecture.lecturer);
        setNewScheduleSubjectCodes(entry.lecture.subjectCodes);
        setNewScheduleDurationHours(entry.lecture.durationHours.toString());
        setNewScheduleStartTime(entry.lecture.startTime || '08:00');
    };

    /**
     * Saves changes to an existing schedule entry.
     */
    const handleUpdateScheduleEntry = async () => {
        if (!editingScheduleId || newScheduleDays.length === 0 || !newScheduleLectureName.trim() || !newScheduleLecturerName.trim() || !newScheduleSubjectCodes.trim() || !newScheduleDurationHours || !newScheduleStartTime) {
            setMessage({ type: 'error', text: 'Please fill all schedule details for update, including at least one day and a start time.' });
            return;
        }

        const updatedSchedule = (hall.schedule || []).map(entry => {
            if (entry.scheduleId === editingScheduleId) {
                return {
                    ...entry,
                    days: newScheduleDays,
                    lecture: {
                        name: newScheduleLectureName.trim(),
                        lecturer: newScheduleLecturerName.trim(),
                        subjectCodes: newScheduleSubjectCodes.trim(),
                        durationHours: parseFloat(newScheduleDurationHours),
                        startTime: newScheduleStartTime,
                    },
                };
            }
            return entry;
        });

        await updateHallInFirestore(hall.id, { schedule: updatedSchedule });
        setMessage({ type: 'success', text: 'Schedule entry updated!' });
        // Clear form and exit editing mode
        setNewScheduleLectureName('');
        setNewScheduleLecturerName('');
        setNewScheduleSubjectCodes('');
        setNewScheduleDurationHours('');
        setNewScheduleStartTime('08:00');
        setNewScheduleDays([]);
        setEditingScheduleId(null);
    };

    /**
     * Deletes a scheduled lecture entry.
     */
    const handleDeleteScheduleEntry = async (scheduleIdToDelete) => {
        const updatedSchedule = (hall.schedule || []).filter(entry => entry.scheduleId !== scheduleIdToDelete);
        const updatedData = {
            schedule: updatedSchedule,
            isScheduled: updatedSchedule.length > 0,
        };
        await updateHallInFirestore(hall.id, updatedData);
        setMessage({ type: 'info', text: 'Schedule entry deleted.' });
        if (editingScheduleId === scheduleIdToDelete) {
            setNewScheduleLectureName('');
            setNewScheduleLecturerName('');
            setNewScheduleSubjectCodes('');
            setNewScheduleDurationHours('');
            setNewScheduleStartTime('08:00');
            setNewScheduleDays([]);
            setEditingScheduleId(null);
        }
    };

    const handleLogAttendance = async () => {
        const count = parseInt(currentAttendanceInput);
        if (isNaN(count) || count < 0) {
            setMessage({ type: 'error', text: 'Please enter a valid attendance count.' });
            return;
        }

        const newRecord = {
            timestamp: new Date(),
            count: count,
            user: "Admin/Lecturer" // Placeholder for actual user logging
        };

        const updatedAttendanceRecords = [...(hall.attendanceRecords || []), newRecord];
        await updateHallInFirestore(hall.id, { attendanceRecords: updatedAttendanceRecords });
        addRecord('Attendance Log', hall.name, `Logged attendance: ${count} students.`, { count });
        setMessage({ type: 'success', text: `Attendance of ${count} logged successfully!` });
        setCurrentAttendanceInput('');
    };

    const handleSendSpecialRequest = () => {
        if (!specialRequestNotes.trim()) {
            setMessage({ type: 'error', text: 'Please enter details for the special request.' });
            return;
        }
        onSendRequest(hall.id, specialRequestNotes, 'Special Request (Email)', 'Administration', 'responsible.person@university.edu');
        setMessage({ type: 'success', text: 'Special request sent to responsible person.' });
        setSpecialRequestNotes('');
    };

    // Find the scheduled lecture for the current day
    const currentDayOfWeek = new Date().toLocaleString('en-US', { weekday: 'long' });
    const todayScheduledLectures = hall.schedule.filter(s => s.days && s.days.includes(currentDayOfWeek));

    // Sort by start time to pick the earliest or upcoming one to display
    todayScheduledLectures.sort((a, b) => {
        // Robust check for entry.lecture and entry.lecture.startTime
        const timeA = a.lecture?.startTime ? new Date(`1970/01/01 ${a.lecture.startTime}`) : new Date(0);
        const timeB = b.lecture?.startTime ? new Date(`1970/01/01 ${b.lecture.startTime}`) : new Date(0);
        return timeA - timeB;
    });

    const nextScheduledLectureToday = todayScheduledLectures.length > 0 ? todayScheduledLectures[0] : null;


    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto relative animate-slideIn">
                <button onClick={onClose} className="absolute top-4 right-6 text-gray-500 hover:text-gray-700 text-3xl font-semibold">&times;</button>
                <div id="modalMessageBox" className={`message-box ${message.type === 'error' ? 'bg-red-100 text-red-700 border-red-400' : message.type === 'success' ? 'bg-green-100 text-green-700 border-green-400' : 'bg-blue-100 text-blue-700 border-blue-400'} border p-3 rounded-lg text-center mb-4`} style={{ display: message.text ? 'block' : 'none' }}>
                    {message.text}
                </div>
                <h2 className="text-3xl font-bold text-indigo-700 mb-6 text-center">{hall.name} Details</h2>

                {/* Modal Navigation Tabs */}
                <div className="flex justify-center flex-wrap gap-4 mb-6 border-b pb-4">
                    <button
                        className={`${baseButtonClasses} !rounded-lg ${activeDetailTab === 'lectures' ? buttonStyles.primary : buttonStyles.secondary}`}
                        onClick={() => setActiveDetailTab('lectures')}
                    >
                        Lecture Info
                    </button>
                    <button
                        className={`${baseButtonClasses} !rounded-lg ${activeDetailTab === 'facilities' ? buttonStyles.primary : buttonStyles.secondary}`}
                        onClick={() => setActiveDetailTab('facilities')}
                    >
                        Facilities Management
                    </button>
                    <button
                        className={`${baseButtonClasses} !rounded-lg ${activeDetailTab === 'schedule' ? buttonStyles.primary : buttonStyles.secondary}`}
                        onClick={() => setActiveDetailTab('schedule')}
                    >
                        Manage Schedules
                    </button>
                    <button
                        className={`${baseButtonClasses} !rounded-lg ${activeDetailTab === 'attendance' ? buttonStyles.primary : buttonStyles.secondary}`}
                        onClick={() => setActiveDetailTab('attendance')}
                    >
                        Attendance
                    </button>
                </div>


                {/* Tab Content: Lecture Info */}
                {activeDetailTab === 'lectures' && (
                    <>
                        {/* Current Lecture Status */}
                        {hall.currentLecture ? (
                            <div className="bg-blue-50 p-5 rounded-xl shadow-inner mb-6 border border-blue-200">
                                <h3 className="text-xl font-semibold text-blue-800 mb-4 border-b pb-2">📚 Current Lecture</h3>
                                <p className="text-md mb-2"><strong className="text-blue-700">Lecture:</strong> {hall.currentLecture.name}</p>
                                <p className="text-md mb-2"><strong className="text-blue-700">Lecturer:</strong> {hall.currentLecture.lecturer}</p>
                                <p className="text-md mb-2"><strong className="text-blue-700">Subject Codes:</strong> {hall.currentLecture.subjectCodes}</p>
                                <p className="text-md mb-2"><strong className="text-blue-700">Students:</strong> {hall.currentLecture.studentsCount}</p>
                                <p className="text-md mb-2"><strong className="text-blue-700">Duration:</strong> {hall.currentLecture.durationHours} hours</p>
                                {/* Added check for hall.currentLecture.endTime */}
                                <p className="text-md mb-2"><strong className="text-blue-700">Ends At:</strong> {hall.currentLecture.endTime ? new Date(hall.currentLecture.endTime.toDate ? hall.currentLecture.endTime.toDate() : hall.currentLecture.endTime).toLocaleTimeString() : 'N/A'}</p>
                                <button
                                    onClick={() => onMarkHallFree(hall.id)}
                                    className={`${baseButtonClasses} ${buttonStyles.danger} w-full mt-4`}
                                >
                                    Mark as Free
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Predefined Schedule Actions */}
                                {hall.isScheduled && (
                                    <div className="bg-purple-50 p-5 rounded-xl shadow-inner mb-6 border border-purple-200">
                                        <h3 className="text-xl font-semibold text-purple-800 mb-4 border-b pb-2">📅 Quick Schedule Actions</h3>
                                        <p className="text-md mb-4 text-gray-700">Use these actions for quick status updates based on schedule.</p>
                                        {nextScheduledLectureToday ? (
                                            <div className="mb-4 p-3 bg-purple-100 rounded-md">
                                                <p className="font-semibold text-purple-800">Next Scheduled Today:</p>
                                                <p className="text-sm text-purple-700">
                                                    {nextScheduledLectureToday.lecture.name} by {nextScheduledLectureToday.lecture.lecturer}
                                                </p>
                                                <p className="text-sm text-purple-700">
                                                    at {nextScheduledLectureToday.lecture.startTime} for {nextScheduledLectureToday.lecture.durationHours} hours
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="text-gray-600 mb-4">No lectures scheduled for today in this hall.</p>
                                        )}
                                        <div className="flex flex-wrap gap-3 justify-center">
                                            <button
                                                className={`${baseButtonClasses} ${hall.currentLecture?.isScheduledLecture ? buttonStyles.info : buttonStyles.success} !py-1.5 !text-sm`}
                                                onClick={() => onMarkScheduledLecture(hall.id, nextScheduledLectureToday)}
                                                disabled={!nextScheduledLectureToday || hall.currentLecture} // Disable if no scheduled lecture or if occupied
                                            >
                                                {hall.currentLecture?.isScheduledLecture ? '✅ Lecture is On' : '✅ Mark Lecture Held (Today)'}
                                            </button>
                                            <button
                                                className={`${baseButtonClasses} ${buttonStyles.danger} !py-1.5 !text-sm`}
                                                onClick={() => onMarkScheduledSkipped(hall.id, nextScheduledLectureToday)}
                                                disabled={!hall.currentLecture && !nextScheduledLectureToday} // Allow canceling if there's an ongoing or upcoming scheduled lecture
                                            >
                                                ❌ No Lecture Today
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Add New Lecture Form */}
                                <div className="bg-orange-50 p-5 rounded-xl shadow-inner mb-6 border border-orange-200">
                                    <h3 className="text-xl font-semibold text-orange-800 mb-4 border-b pb-2">➕ Add New Lecture</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <input type="text" placeholder="Lecture Name" value={lectureName} onChange={(e) => setLectureName(e.target.value)} className={formInputClasses} />
                                        <input type="text" placeholder="Lecturer Name" value={lecturerName} onChange={(e) => setLecturerName(e.target.value)} className={formInputClasses} />
                                        <input type="text" placeholder="Subject Codes (e.g., CS101)" value={subjectCodes} onChange={(e) => setSubjectCodes(e.target.value)} className={formInputClasses} />
                                        <input type="number" placeholder="Students Count (Optional)" value={studentsCount} onChange={(e) => setStudentsCount(e.target.value)} className={formInputClasses} />
                                        <input type="number" placeholder="Duration (hours)" value={durationHours} onChange={(e) => setDurationHours(e.target.value)} step="0.5" className={formInputClasses} />
                                        <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={formInputClasses} />
                                    </div>
                                    <button
                                        onClick={handleSubmitLecture}
                                        className={`${baseButtonClasses} ${buttonStyles.primary} w-full mt-6`}
                                    >
                                        💾 Start Lecture
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Special Request / Issues - Email Simulation */}
                        <div className="bg-yellow-50 p-5 rounded-xl shadow-inner mb-6 border border-yellow-200">
                            <h3 className="text-xl font-semibold text-yellow-800 mb-4 border-b pb-2">📧 Special Requests (Email)</h3>
                            <p className="text-sm text-gray-700 mb-3">Send a special request or report a critical issue directly to the responsible person via simulated email.</p>
                            <textarea
                                className={`${formInputClasses} min-h-[80px]`}
                                placeholder="Describe your special request or critical issue here. This will be 'emailed' to relevant personnel."
                                value={specialRequestNotes}
                                onChange={(e) => setSpecialRequestNotes(e.target.value)}
                            ></textarea>
                            <button
                                className={`${baseButtonClasses} ${buttonStyles.dark} w-full mt-4`}
                                onClick={handleSendSpecialRequest}
                            >
                                Send Special Request
                            </button>
                        </div>
                    </>
                )}

                {/* Tab Content: Facilities Management */}
                {activeDetailTab === 'facilities' && (
                    <div className="bg-gray-50 p-5 rounded-xl shadow-inner mb-6 border border-gray-200">
                        <h3 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">📊 Facilities Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="form-group">
                                <label className="block text-gray-700 text-sm font-bold mb-2">Chairs Available:</label>
                                <input
                                    type="number"
                                    className={formInputClasses}
                                    value={editableChairsAvailable}
                                    onChange={(e) => setEditableChairsAvailable(parseInt(e.target.value) || 0)}
                                    min="0"
                                />
                            </div>
                            <div className="form-group flex items-center mt-2">
                                <input
                                    type="checkbox"
                                    className="mr-2 h-5 w-5 text-indigo-600 rounded focus:ring-indigo-500"
                                    checked={editableSmartBoard}
                                    onChange={(e) => setEditableSmartBoard(e.target.checked)}
                                />
                                <label className="text-gray-700 text-base font-bold">Smart Board</label>
                            </div>
                            <div className="form-group flex items-center">
                                <input
                                    type="checkbox"
                                    className="mr-2 h-5 w-5 text-indigo-600 rounded focus:ring-indigo-500"
                                    checked={editableWhiteBoard}
                                    onChange={(e) => setEditableWhiteBoard(e.target.checked)}
                                />
                                <label className="text-gray-700 text-base font-bold">White Board</label>
                            </div>
                            <div className="form-group flex items-center">
                                <input
                                    type="checkbox"
                                    className="mr-2 h-5 w-5 text-indigo-600 rounded focus:ring-indigo-500"
                                    checked={editablePensAvailable}
                                    onChange={(e) => setEditablePensAvailable(e.target.checked)}
                                />
                                <label className="text-gray-700 text-base font-bold">Pens Available</label>
                            </div>
                        </div>

                        {/* AC Unit Management */}
                        <div className="form-group mt-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Total AC Units:</label>
                            <input
                                type="number"
                                className={formInputClasses}
                                value={editableAcCount}
                                onChange={(e) => setEditableAcCount(parseInt(e.target.value) || 0)}
                                min="0"
                            />
                            <p className="text-sm text-gray-600 mt-1">Adjust the number of AC units in this hall. New units default to working.</p>
                        </div>
                        <p className="text-md mb-2 mt-4"><strong className="text-gray-700">Individual AC Units Status:</strong></p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-2">
                            {editableAcMachines.map(ac => (
                                <button
                                    key={ac.id}
                                    className={`${baseButtonClasses} !py-1.5 !px-2 !text-xs ${ac.working ? buttonStyles.success : buttonStyles.danger}`}
                                    onClick={() => toggleLocalACStatus(ac.id)}
                                >
                                    AC {ac.id.substring(0, 4)}: {ac.working ? 'Working' : 'Broken'}
                                </button>
                            ))}
                        </div>
                        <div className="mt-6">
                            <button onClick={handleSaveFacilities} className={`${baseButtonClasses} ${buttonStyles.primary} w-full`}>
                                Save Facilities Changes
                            </button>
                        </div>
                    </div>
                )}

                {/* Tab Content: Manage Schedules */}
                {activeDetailTab === 'schedule' && (
                    <div className="bg-green-50 p-5 rounded-xl shadow-inner mb-6 border border-green-200">
                        <h3 className="text-xl font-semibold text-green-800 mb-4 border-b pb-2 flex justify-between items-center">
                            📅 Manage Schedules
                            <button
                                className={`${baseButtonClasses} ${buttonStyles.info} !py-1.5 !text-sm`}
                                onClick={() => setShowScheduleEditor(!showScheduleEditor)}
                            >
                                {showScheduleEditor ? 'Hide Editor' : 'Edit Schedules'}
                            </button>
                        </h3>
                        {hall.schedule && hall.schedule.length > 0 ? (
                            <ul className="mb-4 space-y-3">
                                {hall.schedule.map(entry => (
                                    <li key={entry.scheduleId} className="bg-white p-3 rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center">
                                        <div>
                                            <p className="font-semibold text-gray-800">
                                                {entry.days && entry.days.length > 0 ? entry.days.join(', ') : 'No Days Set'} @ {entry.lecture?.startTime || 'N/A'}: {entry.lecture?.name || 'N/A'}
                                            </p>
                                            <p className="text-sm text-gray-600">by {entry.lecture?.lecturer || 'N/A'} ({entry.lecture?.subjectCodes || 'N/A'}) - {entry.lecture?.durationHours || 'N/A'}h</p>
                                        </div>
                                        <div className="flex gap-2 mt-2 sm:mt-0">
                                            <button
                                                className={`${baseButtonClasses} ${buttonStyles.info} !py-1.5 !text-xs`}
                                                onClick={() => startEditingSchedule(entry)}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                className={`${baseButtonClasses} ${buttonStyles.danger} !py-1.5 !text-xs`}
                                                onClick={() => handleDeleteScheduleEntry(entry.scheduleId)}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-gray-600 mb-4">No predefined schedules for this hall.</p>
                        )}

                        {showScheduleEditor && (
                            <div className="border-t pt-4 mt-4 border-gray-200">
                                <h4 className="text-lg font-semibold text-gray-700 mb-3">{editingScheduleId ? 'Edit Schedule Entry' : 'Add New Schedule Entry'}</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="form-group col-span-full">
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Select Days:</label>
                                        <div className="flex flex-wrap gap-2">
                                            {daysOfWeek.map(day => (
                                                <label key={day} className="inline-flex items-center text-gray-700">
                                                    <input
                                                        type="checkbox"
                                                        className="form-checkbox h-5 w-5 text-indigo-600 rounded focus:ring-indigo-500"
                                                        value={day}
                                                        checked={newScheduleDays.includes(day)}
                                                        onChange={(e) => handleDayCheckboxChange(day, e.target.checked)}
                                                    />
                                                    <span className="ml-2 text-sm">{day}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <input type="time" placeholder="Start Time" value={newScheduleStartTime} onChange={(e) => setNewScheduleStartTime(e.target.value)} className={formInputClasses} />
                                    <input type="text" placeholder="Lecture Name" value={newScheduleLectureName} onChange={(e) => setNewScheduleLectureName(e.target.value)} className={formInputClasses} />
                                    <input type="text" placeholder="Lecturer Name" value={newScheduleLecturerName} onChange={(e) => setNewScheduleLecturerName(e.target.value)} className={formInputClasses} />                                     <input type="text" placeholder="Subject Codes" value={newScheduleSubjectCodes} onChange={(e) => setNewScheduleSubjectCodes(e.target.value)} className={formInputClasses} />
                                    <input type="number" placeholder="Duration (hours)" value={newScheduleDurationHours} onChange={(e) => setNewScheduleDurationHours(e.target.value)} step="0.5" className={formInputClasses} />
                                </div>
                                <button
                                    className={`${baseButtonClasses} ${buttonStyles.primary} w-full mt-4`}
                                    onClick={editingScheduleId ? handleUpdateScheduleEntry : handleAddScheduleEntry}
                                >
                                    {editingScheduleId ? 'Update Schedule' : 'Add Schedule Entry'}
                                </button>
                                {editingScheduleId && (
                                    <button
                                        className={`${baseButtonClasses} ${buttonStyles.secondary} w-full mt-2`}
                                        onClick={() => {
                                            setEditingScheduleId(null);
                                            setNewScheduleLectureName('');
                                            setNewScheduleLecturerName('');
                                            setNewScheduleSubjectCodes('');
                                            setNewScheduleDurationHours('');
                                            setNewScheduleStartTime('08:00');
                                            setNewScheduleDays([]);
                                        }}
                                    >
                                        Cancel Edit
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab Content: Attendance */}
                {activeDetailTab === 'attendance' && (
                    <div className="bg-blue-50 p-5 rounded-xl shadow-inner mb-6 border border-blue-200">
                        <h3 className="text-xl font-semibold text-blue-800 mb-4 border-b pb-2">📈 Attendance Log</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end mb-6">
                            <div>
                                <label htmlFor="attendanceCount" className="block text-gray-700 text-sm font-bold mb-2">Students Attended:</label>
                                <input
                                    type="number"
                                    id="attendanceCount"
                                    className={formInputClasses}
                                    value={currentAttendanceInput}
                                    onChange={(e) => setCurrentAttendanceInput(e.target.value)}
                                    placeholder="Enter count"
                                    min="0"
                                />
                            </div>
                            <button
                                className={`${baseButtonClasses} ${buttonStyles.primary} w-full h-10`}
                                onClick={handleLogAttendance}
                            >
                                Log Attendance
                            </button>
                        </div>

                        {hall.attendanceRecords && hall.attendanceRecords.length > 0 ? (
                            <div className="max-h-60 overflow-y-auto pr-2">
                                <table className="w-full text-sm text-left text-gray-600">
                                    <thead className="text-xs text-gray-700 uppercase bg-gray-200/50 sticky top-0 z-10 backdrop-blur-sm">
                                        <tr>
                                            <th scope="col" className="px-4 py-2">Date & Time</th>
                                            <th scope="col" className="px-4 py-2">Count</th>
                                            <th scope="col" className="px-4 py-2">Logged By</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {hall.attendanceRecords.sort((a,b) => {
                                            // Robust check for timestamp property and toDate() method
                                            const timeA = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate() : new Date(0);
                                            const timeB = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate() : new Date(0);
                                            return timeB - timeA;
                                        }).map((record, index) => (
                                            <tr key={index} className="bg-white/60 border-b border-gray-200/80 hover:bg-gray-50/80">
                                                {/* Added check for record.timestamp */}
                                                <td className="px-4 py-2">{record.timestamp ? new Date(record.timestamp.toDate ? record.timestamp.toDate() : record.timestamp).toLocaleString() : 'N/A'}</td>
                                                <td className="px-4 py-2 font-medium">{record.count}</td>
                                                <td className="px-4 py-2 text-xs">{record.user || 'N/A'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-center text-gray-500 py-4">No attendance records for this hall yet.</p>
                        )}
                    </div>
                )}


                {/* Action Buttons at bottom */}
                <div className="flex flex-wrap justify-center gap-3 mt-6">
                    <button onClick={onClose} className={`${baseButtonClasses} ${buttonStyles.secondary}`}>
                        Close
                    </button>
                    {hall.status !== 'cleaning' && (
                        <button onClick={() => onStartCleaning(hall.id)} className={`${baseButtonClasses} ${buttonStyles.success}`}>
                            🧹 Start Cleaning
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function CleaningModal({ hall, onClose, onCompleteCleaning }) {
    const [cleanerName, setCleanerName] = useState('');
    const [employeeId, setEmployeeId] = useState('');
    const [cleaningNotes, setCleaningNotes] = useState('');
    const [message, setMessage] = useState({ type: '', text: '' }); // For modal-specific messages

    useEffect(() => {
        // Pre-fill if current cleaning data exists (e.g., if re-opened)
        setCleanerName(hall.cleaningStatus.cleanedBy || '');
        setEmployeeId(hall.cleaningStatus.employeeId || '');
        setCleaningNotes(''); // Always clear notes for a new entry
    }, [hall]);

    const handleCompleteCleaning = () => {
        if (!cleanerName || !employeeId) {
            setMessage({ type: 'error', text: 'Please enter cleaner name and employee ID.' });
            return;
        }
        onCompleteCleaning(hall.id, { cleanerName, employeeId, cleaningNotes });
        // Message will be handled by parent's onCompleteCleaning -> Firestore listener
        // onClose(); // Parent handles closing
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto relative animate-slideIn">
                <button onClick={onClose} className="absolute top-4 right-6 text-gray-500 hover:text-gray-700 text-3xl font-semibold">&times;</button>
                <div id="cleaningModalMessageBox" className={`message-box ${message.type === 'error' ? 'bg-red-100 text-red-700 border-red-400' : message.type === 'success' ? 'bg-green-100 text-green-700 border-green-400' : 'bg-blue-100 text-blue-700 border-blue-400'} border p-3 rounded-lg text-center mb-4`} style={{ display: message.text ? 'block' : 'none' }}>
                    {message.text}
                </div>
                <h2 className="text-3xl font-bold text-indigo-700 mb-6 text-center">🧹 Cleaning Update for {hall.name}</h2>

                <div className="grid grid-cols-1 gap-4 mb-6">
                    <input type="text" placeholder="Cleaner's Name" value={cleanerName} onChange={(e) => setCleanerName(e.target.value)} className={formInputClasses} />
                    <input type="text" placeholder="Employee ID" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={formInputClasses} />
                    <textarea placeholder="Cleaning Notes (Optional)" value={cleaningNotes} onChange={(e) => setCleaningNotes(e.target.value)} className={`${formInputClasses} min-h-[80px]`}></textarea>
                </div>

                <div className="flex flex-wrap justify-center gap-3">
                    <button onClick={handleCompleteCleaning} className={`${baseButtonClasses} ${buttonStyles.success} w-full sm:w-auto`}>
                        ✅ Mark as Clean
                    </button>
                    <button onClick={onClose} className={`${baseButtonClasses} ${buttonStyles.secondary} w-full sm:w-auto`}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

export default App;
