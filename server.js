import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import crypto from 'crypto'

// --- Database Setup ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, 'db.json')
const adapter = new JSONFile(file)
const db = new Low(adapter, { attendance: [], users: [] })
await db.read()

// --- In-Memory Session Storage ---
let activeSession = { token: null, subject: null, expiresAt: null };

// --- Geofencing & Server Config ---
const CLASSROOM_LAT = 18.4725;
const CLASSROOM_LON = 74.0015;
const ALLOWED_RADIUS_METERS = 50;
const TOKEN_VALIDITY_MINUTES = 5;
const app = express()
const PORT = process.env.PORT || 3000; // Use port from environment or default to 3000
const BASE_URL = process.env.BASE_URL || `http://192.168.1.5:${PORT}`; // Use live URL or local IP

app.use(express.json())
app.use(express.static(join(__dirname, 'public')))

// --- Helper Functions (getDistance is unchanged) ---
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- NEW CONFIGURATION ROUTE ---
app.get('/config', (req, res) => {
    res.json({ baseUrl: BASE_URL });
});

// --- All other routes (TEACHER, STUDENT, AUTH, ATTENDANCE) remain exactly the same ---
// ... (no changes to the rest of the routes) ...

// --- TEACHER ROUTES ---
app.post('/teacher/start-session', (req, res) => {
    const { subject } = req.body;
    if (!subject) return res.status(400).json({ message: "Subject is required." });
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(new Date().getTime() + TOKEN_VALIDITY_MINUTES * 60000);
    activeSession = { token, subject, expiresAt };
    res.json({ token });
});
// --- STUDENT ROUTES ---
app.get('/student/verify-token', (req, res) => {
    const { token } = req.query;
    if (!activeSession.token || activeSession.token !== token) return res.status(404).json({ message: "Invalid session token." });
    if (new Date() > activeSession.expiresAt) return res.status(410).json({ message: "Session has expired." });
    res.json({ subject: activeSession.subject });
});
// --- AUTH ROUTES ---
app.post('/auth/register', async (req, res) => {
    const { studentId, password } = req.body;
    if (!studentId || !password) return res.status(400).json({ message: 'Student ID and password are required.' });
    const existingUser = db.data.users.find(user => user.studentId === studentId);
    if (existingUser) return res.status(409).json({ message: 'This Student ID is already registered.' });
    db.data.users.push({ studentId, password });
    await db.write();
    res.status(201).json({ message: 'Registration successful! You can now log in.' });
});
app.post('/auth/login', async (req, res) => {
    const { studentId, password } = req.body;
    if (!studentId || !password) return res.status(400).json({ message: 'Student ID and password are required.' });
    const user = db.data.users.find(u => u.studentId === studentId);
    if (!user || user.password !== password) return res.status(401).json({ message: 'Invalid Student ID or password.' });
    res.json({ message: 'Login successful!', studentId: user.studentId });
});
// --- ATTENDANCE ROUTES ---
app.get('/get-attendance', (req, res) => res.json(db.data.attendance.slice().reverse()));
app.get('/get-student-attendance', (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json([]);
  const studentRecords = db.data.attendance.filter(record => record.studentId === studentId);
  res.json(studentRecords.slice().reverse());
});
app.post('/mark-attendance', async (req, res) => {
  const { studentId, latitude, longitude, token } = req.body;
  if (!activeSession.token || activeSession.token !== token || new Date() > activeSession.expiresAt) return res.status(403).json({ message: "Invalid or expired session." });
  const subject = activeSession.subject;
  const distance = getDistance(latitude, longitude, CLASSROOM_LAT, CLASSROOM_LON);
  if (distance > ALLOWED_RADIUS_METERS) return res.status(403).json({ message: `You are too far away. Distance: ${distance.toFixed(0)}m` });
  const todayDateString = new Date().toISOString().split('T')[0];
  const alreadyMarked = db.data.attendance.find(record => record.studentId === studentId && record.subject === subject && record.timestamp.startsWith(todayDateString));
  if (alreadyMarked) return res.status(409).json({ message: `Attendance already marked for ${subject} today.` });
  db.data.attendance.push({ studentId, subject, timestamp: new Date().toISOString(), location: { lat: latitude, lon: longitude } });
  await db.write();
  res.json({ message: `Attendance for ${subject} marked successfully!` });
});


// --- Start Server ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running! Access it at ${BASE_URL}`);
});