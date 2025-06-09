const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

class FacialRecognitionApp {
    constructor() {
        this.mainWindow = null;
        this.setupAppEvents();
        this.setupIPCHandlers();
    }

    setupAppEvents() {
        app.whenReady().then(() => {
            this.createMainWindow();
            this.setupDataDirectories();
        });

        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                this.createMainWindow();
            }
        });
    }

    createMainWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            minWidth: 1000,
            minHeight: 700,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            icon: path.join(__dirname, 'assets', 'icon.ico'),
            title: 'Sistema de Reconocimiento Facial - Seguridad de Redes',
            show: false,
            frame: true,
            titleBarStyle: 'default',
            backgroundColor: '#1e1e1e'
        });

        this.mainWindow.loadFile('index.html');

        // Mostrar ventana cuando esté lista
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
            
            // Abrir DevTools en modo desarrollo
            if (process.argv.includes('--dev')) {
                this.mainWindow.webContents.openDevTools();
            }
        });

        // Manejar cierre de ventana
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });
    }

    setupDataDirectories() {
        const dataDir = path.join(__dirname, 'data');
        const studentsDir = path.join(dataDir, 'students');
        const attendanceDir = path.join(dataDir, 'attendance');

        [dataDir, studentsDir, attendanceDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    setupIPCHandlers() {
        // Guardar estudiante
        ipcMain.handle('save-student', async (event, studentData) => {
            try {
                const studentDir = path.join(__dirname, 'data', 'students', studentData.code);
                
                if (!fs.existsSync(studentDir)) {
                    fs.mkdirSync(studentDir, { recursive: true });
                }

                // Guardar información del estudiante
                const infoPath = path.join(studentDir, 'info.json');
                const info = {
                    code: studentData.code,
                    name: studentData.name,
                    registrationDate: new Date().toISOString(),
                    framesCount: studentData.frames.length
                };

                fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));

                // Guardar frames como imágenes
                studentData.frames.forEach((frameData, index) => {
                    const base64Data = frameData.replace(/^data:image\/jpeg;base64,/, '');
                    const buffer = Buffer.from(base64Data, 'base64');
                    const framePath = path.join(studentDir, `frame_${index.toString().padStart(2, '0')}.jpg`);
                    fs.writeFileSync(framePath, buffer);
                });

                return { success: true, message: 'Estudiante guardado correctamente' };
            } catch (error) {
                return { success: false, message: error.message };
            }
        });

        // Cargar historial de estudiantes
        ipcMain.handle('load-students', async () => {
            try {
                const studentsDir = path.join(__dirname, 'data', 'students');
                const students = [];

                if (fs.existsSync(studentsDir)) {
                    const studentFolders = fs.readdirSync(studentsDir);
                    
                    for (const folder of studentFolders) {
                        const infoPath = path.join(studentsDir, folder, 'info.json');
                        if (fs.existsSync(infoPath)) {
                            const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
                            students.push(info);
                        }
                    }
                }

                return students;
            } catch (error) {
                return [];
            }
        });

        // Cargar asistencias del día
        ipcMain.handle('load-attendance', async (event, date) => {
            try {
                const attendanceDir = path.join(__dirname, 'data', 'attendance', date);
                const recordsPath = path.join(attendanceDir, 'records.json');
                
                if (fs.existsSync(recordsPath)) {
                    const records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
                    return records;
                }
                
                return [];
            } catch (error) {
                return [];
            }
        });

        // Mostrar diálogo de salida
        ipcMain.handle('show-exit-dialog', async () => {
            const result = await dialog.showMessageBox(this.mainWindow, {
                type: 'question',
                buttons: ['Sí', 'No'],
                defaultId: 1,
                title: 'Salir',
                message: '¿Está seguro que desea salir del sistema?'
            });

            return result.response === 0;
        });

        // Salir de la aplicación
        ipcMain.handle('exit-app', () => {
            app.quit();
        });
    }
}

// Inicializar aplicación
new FacialRecognitionApp();