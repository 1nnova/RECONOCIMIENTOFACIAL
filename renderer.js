const { ipcRenderer } = require('electron');

class FacialRecognitionRenderer {
    constructor() {
        this.mainCamera = null;
        this.registrationCamera = null;
        this.attendanceCamera = null;
        this.isRecording = false;
        this.recordingStartTime = 0;
        this.recordingDuration = 10000; // 10 segundos
        this.recordedFrames = [];
        this.recordingInterval = null;
        
        // Variables para reconocimiento
        this.recognitionInterval = null;
        this.isRecognitionActive = false;
        this.lastRecognitionTime = 0;
        this.recognitionDelay = 2000; // 2 segundos entre reconocimientos
        
        // Variables para cuadros faciales
        this.faceMeshCanvas = null;
        this.faceMeshCtx = null;
        this.showFaceMesh = true;

        this.initializeApp();
    }

    async initializeApp() {
        await this.initializeMainCamera();
        this.updateStatus('Sistema listo - Cámara inicializada correctamente', 'success');
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Eventos de botones principales
        document.getElementById('studentRegistrationBtn').addEventListener('click', () => this.openStudentRegistration());
        document.getElementById('attendanceRegistrationBtn').addEventListener('click', () => this.openAttendanceRegistration());
        document.getElementById('historyBtn').addEventListener('click', () => this.openHistory());
        document.getElementById('exitBtn').addEventListener('click', () => this.exitApplication());

        // Eventos de modales
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                this.closeModal(e.target.getAttribute('data-modal'));
            });
        });

        // Eventos de registro
        document.getElementById('recordButton').addEventListener('click', () => this.toggleRecording());
        document.getElementById('saveStudentBtn').addEventListener('click', () => this.saveStudent());
        document.getElementById('cancelRegistrationBtn').addEventListener('click', () => this.closeModal('studentModal'));

        // Eventos de historial
        document.getElementById('refreshHistoryBtn').addEventListener('click', () => this.loadStudentHistory());
        
        // Eventos de reconocimiento
        document.getElementById('startRecognitionBtn').addEventListener('click', () => {
            if (this.isRecognitionActive) {
                this.stopFaceRecognition();
            } else {
                this.startFaceRecognition();
            }
        });
        
        // EVENTO PARA TOGGLE CUADROS
        document.getElementById('toggleMeshBtn').addEventListener('click', () => this.toggleFaceMesh());
        
        document.getElementById('viewAttendanceBtn').addEventListener('click', () => this.viewTodayAttendance());
    }

    async initializeMainCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 } 
            });
            
            const video = document.getElementById('cameraVideo');
            const placeholder = document.getElementById('cameraPlaceholder');
            
            video.srcObject = stream;
            video.style.display = 'block';
            placeholder.style.display = 'none';
            
            this.mainCamera = stream;
            
        } catch (error) {
            console.error('Error al acceder a la cámara:', error);
            this.updateStatus('Error al inicializar cámara: ' + error.message, 'error');
        }
    }

    async initializeRegistrationCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 } 
            });
            
            const video = document.getElementById('registrationVideo');
            video.srcObject = stream;
            this.registrationCamera = stream;
            
        } catch (error) {
            console.error('Error al acceder a la cámara de registro:', error);
            this.showAlert('Error al inicializar cámara de registro: ' + error.message);
        }
    }

    async initializeAttendanceCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 } 
            });
            
            const video = document.getElementById('attendanceVideo');
            video.srcObject = stream;
            this.attendanceCamera = stream;
            
        } catch (error) {
            console.error('Error al acceder a la cámara de asistencias:', error);
            this.showAlert('Error al inicializar cámara: ' + error.message);
        }
    }

    updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('statusText');
        const colors = {
            'info': '#ffffff',
            'success': '#00ff00',
            'error': '#ff0000',
            'warning': '#ffaa00'
        };
        
        statusElement.textContent = message;
        statusElement.style.color = colors[type] || '#ffffff';
    }

    async openStudentRegistration() {
        this.updateStatus('Abriendo registro de alumnos...', 'info');
        document.getElementById('studentModal').style.display = 'block';
        await this.initializeRegistrationCamera();
    }

    async openAttendanceRegistration() {
        this.updateStatus('Abriendo registro de asistencias...', 'info');
        document.getElementById('attendanceModal').style.display = 'block';
        await this.initializeAttendanceCamera();
    }

    openHistory() {
        this.updateStatus('Abriendo historial de registros...', 'info');
        document.getElementById('historyModal').style.display = 'block';
        this.loadStudentHistory();
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
        
        if (modalId === 'studentModal' && this.registrationCamera) {
            this.registrationCamera.getTracks().forEach(track => track.stop());
            this.registrationCamera = null;
            this.resetRecordingState();
        }
        
        if (modalId === 'attendanceModal') {
            this.stopFaceRecognition();
            if (this.attendanceCamera) {
                this.attendanceCamera.getTracks().forEach(track => track.stop());
                this.attendanceCamera = null;
            }
            
            // Limpiar cuadros
            this.clearFaceMesh();
            if (this.faceMeshCanvas) {
                this.faceMeshCanvas.remove();
                this.faceMeshCanvas = null;
                this.faceMeshCtx = null;
            }
            
            // RESETEAR BOTÓN DE CUADROS
            const toggleButton = document.getElementById('toggleMeshBtn');
            if (toggleButton) {
                this.showFaceMesh = true; // Resetear a estado inicial
                toggleButton.textContent = '👁️ Ocultar Cuadros';
                toggleButton.classList.remove('mesh-hidden');
            }
        }
    }

    resetRecordingState() {
        this.isRecording = false;
        this.recordedFrames = [];
        document.getElementById('recordButton').textContent = '🎥 Iniciar Grabación';
        document.getElementById('recordButton').classList.remove('recording');
        document.getElementById('timeDisplay').textContent = 'Tiempo: 0/10s';
        document.getElementById('progressBar').style.width = '0%';
        
        if (this.recordingInterval) {
            clearInterval(this.recordingInterval);
            this.recordingInterval = null;
        }
    }

    toggleRecording() {
        if (!this.isRecording) {
            this.startRecording();
        } else {
            this.stopRecording();
        }
    }

    startRecording() {
        const code = document.getElementById('studentCode').value.trim();
        const name = document.getElementById('studentName').value.trim();
        
        if (!code || !name) {
            this.showAlert('Por favor complete el código y nombre del alumno antes de grabar.');
            return;
        }
        
        this.isRecording = true;
        this.recordedFrames = [];
        this.recordingStartTime = Date.now();
        
        const recordButton = document.getElementById('recordButton');
        recordButton.textContent = '⏹️ Detener Grabación';
        recordButton.classList.add('recording');
        
        // Capturar frames cada 100ms
        const captureInterval = setInterval(() => {
            if (!this.isRecording) {
                clearInterval(captureInterval);
                return;
            }
            this.captureFrame();
        }, 100);
        
        // Actualizar progreso
        this.recordingInterval = setInterval(() => {
            if (!this.isRecording) {
                clearInterval(this.recordingInterval);
                return;
            }
            
            const elapsed = Date.now() - this.recordingStartTime;
            const progress = (elapsed / this.recordingDuration) * 100;
            
            document.getElementById('timeDisplay').textContent = 
                `Tiempo: ${Math.floor(elapsed / 1000)}/${this.recordingDuration / 1000}s`;
            document.getElementById('progressBar').style.width = progress + '%';
            
            if (elapsed >= this.recordingDuration) {
                this.stopRecording();
            }
        }, 100);
        
        this.showAlert('Grabación iniciada. Siga las instrucciones durante 10 segundos.');
    }

    captureFrame() {
        const video = document.getElementById('registrationVideo');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        
        const frameData = canvas.toDataURL('image/jpeg', 0.8);
        this.recordedFrames.push(frameData);
    }

    stopRecording() {
        this.isRecording = false;
        
        const recordButton = document.getElementById('recordButton');
        recordButton.textContent = '🎥 Iniciar Grabación';
        recordButton.classList.remove('recording');
        
        document.getElementById('progressBar').style.width = '100%';
        document.getElementById('timeDisplay').textContent = 
            `Grabación completada: ${this.recordedFrames.length} frames`;
        
        if (this.recordingInterval) {
            clearInterval(this.recordingInterval);
            this.recordingInterval = null;
        }
        
        this.showAlert(`Grabación completada. Se capturaron ${this.recordedFrames.length} frames.`);
    }

    async saveStudent() {
        const code = document.getElementById('studentCode').value.trim();
        const name = document.getElementById('studentName').value.trim();
        
        if (!code || !name) {
            this.showAlert('Por favor complete todos los campos.');
            return;
        }
        
        if (this.recordedFrames.length === 0) {
            this.showAlert('Por favor grabe un video antes de guardar.');
            return;
        }
        
        const studentData = {
            code: code,
            name: name,
            frames: this.recordedFrames.slice(0, 20) // Máximo 20 frames
        };
        
        try {
            const result = await ipcRenderer.invoke('save-student', studentData);
            
            if (result.success) {
                this.showAlert(`Estudiante ${name} registrado correctamente.\nCódigo: ${code}`);
                this.clearRegistrationForm();
                
                // Recargar estudiantes en el backend
                await this.reloadStudentsInBackend();
            } else {
                this.showAlert('Error al guardar estudiante: ' + result.message);
            }
        } catch (error) {
            this.showAlert('Error al guardar estudiante: ' + error.message);
        }
    }

    async reloadStudentsInBackend() {
        try {
            const response = await fetch('http://127.0.0.1:5000/api/students/reload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const result = await response.json();
            if (result.success) {
                this.updateStatus(result.message, 'success');
            }
        } catch (error) {
            console.log('Backend no disponible para recarga automática');
        }
    }

    clearRegistrationForm() {
        document.getElementById('studentCode').value = '';
        document.getElementById('studentName').value = '';
        this.recordedFrames = [];
        document.getElementById('progressBar').style.width = '0%';
        document.getElementById('timeDisplay').textContent = 'Tiempo: 0/10s';
    }

    async loadStudentHistory() {
        try {
            const students = await ipcRenderer.invoke('load-students');
            const tbody = document.getElementById('historyTableBody');
            tbody.innerHTML = '';
            
            students.forEach(student => {
                const row = tbody.insertRow();
                const regDate = new Date(student.registrationDate);
                const formattedDate = regDate.toLocaleDateString('es-ES') + ' ' + regDate.toLocaleTimeString('es-ES');
                
                row.innerHTML = `
                    <td>${student.code}</td>
                    <td>${student.name}</td>
                    <td>${formattedDate}</td>
                    <td>${student.framesCount || 'N/A'}</td>
                `;
            });
            
        } catch (error) {
            this.showAlert('Error al cargar historial: ' + error.message);
        }
    }

    // Funciones de reconocimiento facial con cuadros
    async startFaceRecognition() {
        if (this.isRecognitionActive) return;
        
        this.isRecognitionActive = true;
        this.updateStatus('Iniciando reconocimiento facial...', 'info');
        
        // Verificar que el backend esté disponible
        try {
            const response = await fetch('http://127.0.0.1:5000/api/status');
            const status = await response.json();
            
            if (!status.system_ready) {
                this.showAlert('Sistema no listo. Asegúrese de que hay estudiantes registrados.');
                this.isRecognitionActive = false;
                return;
            }
            
            this.updateStatus(`Sistema listo - ${status.students_loaded} estudiantes cargados`, 'success');
            
        } catch (error) {
            this.showAlert('Error: No se puede conectar con el backend de Python.\nPor favor ejecute: python facial_recognition_backend_simple.py');
            this.isRecognitionActive = false;
            return;
        }
        
        // Iniciar reconocimiento continuo
        this.recognitionInterval = setInterval(() => {
            this.performRecognition();
        }, this.recognitionDelay);
        
        // Actualizar UI
        document.getElementById('startRecognitionBtn').textContent = '⏹️ Detener Reconocimiento';
        document.getElementById('startRecognitionBtn').style.backgroundColor = '#dc3545';
    }

    async stopFaceRecognition() {
        this.isRecognitionActive = false;
        
        if (this.recognitionInterval) {
            clearInterval(this.recognitionInterval);
            this.recognitionInterval = null;
        }
        
        // Actualizar UI
        document.getElementById('startRecognitionBtn').textContent = '🎯 Iniciar Reconocimiento';
        document.getElementById('startRecognitionBtn').style.backgroundColor = '#28a745';
        
        this.updateStatus('Reconocimiento detenido', 'info');
        this.clearRecognitionResults();
        this.clearFaceMesh();
    }

    async performRecognition() {
        if (!this.isRecognitionActive) return;
        
        try {
            // Capturar frame actual de la cámara
            const video = document.getElementById('attendanceVideo');
            if (!video || !video.videoWidth) return;
            
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);
            
            // Convertir a base64
            const imageData = canvas.toDataURL('image/jpeg', 0.8);
            
            // Enviar al backend para reconocimiento
            const response = await fetch('http://127.0.0.1:5000/api/recognize_with_mesh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image: imageData
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.displayRecognitionResults(result);
                // USAR CUADROS EN LUGAR DE MALLA
                this.drawFaceBoxes(video, result.face_meshes, result.faces);
                
                // Si hay rostros reconocidos, registrar asistencia automáticamente
                if (result.faces.length > 0) {
                    await this.autoRecordAttendance(result.faces);
                }
            }
            
        } catch (error) {
            console.error('Error en reconocimiento:', error);
            this.updateStatus('Error en reconocimiento: ' + error.message, 'error');
        }
    }

    // NUEVAS FUNCIONES PARA CUADROS INDIVIDUALES
    drawFaceBoxes(video, faceMeshes, recognizedFaces) {
        if (!this.showFaceMesh || !recognizedFaces || recognizedFaces.length === 0) {
            this.clearFaceMesh();
            return;
        }
        
        // Crear canvas overlay si no existe
        if (!this.faceMeshCanvas) {
            this.createFaceMeshOverlay(video);
        }
        
        // Limpiar canvas
        this.faceMeshCtx.clearRect(0, 0, this.faceMeshCanvas.width, this.faceMeshCanvas.height);
        
        // Dibujar cuadro para cada persona detectada
        recognizedFaces.forEach((face, index) => {
            this.drawPersonBox(face, index);
        });
    }

    createFaceMeshOverlay(video) {
        // Crear canvas overlay
        this.faceMeshCanvas = document.createElement('canvas');
        this.faceMeshCanvas.width = video.clientWidth;
        this.faceMeshCanvas.height = video.clientHeight;
        this.faceMeshCanvas.style.position = 'absolute';
        this.faceMeshCanvas.style.top = '0';
        this.faceMeshCanvas.style.left = '0';
        this.faceMeshCanvas.style.pointerEvents = 'none';
        this.faceMeshCanvas.style.zIndex = '10';
        
        this.faceMeshCtx = this.faceMeshCanvas.getContext('2d');
        
        // Insertar canvas en el contenedor de video
        const videoContainer = video.parentElement;
        videoContainer.style.position = 'relative';
        videoContainer.appendChild(this.faceMeshCanvas);
    }

    drawPersonBox(face, personIndex) {
        const location = face.location;
        
        // Escalar coordenadas al tamaño del canvas
        const scaleX = this.faceMeshCanvas.width / 640;
        const scaleY = this.faceMeshCanvas.height / 480;
        
        const x = location.left * scaleX;
        const y = location.top * scaleY;
        const width = (location.right - location.left) * scaleX;
        const height = (location.bottom - location.top) * scaleY;
        
        // Colores diferentes para cada persona
        const colors = [
            '#00ff41', // Verde Matrix (persona 1)
            '#ff0066', // Rosa/Magenta (persona 2)
            '#0099ff', // Azul (persona 3)
            '#ffaa00', // Naranja (persona 4)
            '#aa00ff', // Púrpura (persona 5)
            '#ff3300', // Rojo (persona 6)
            '#00ffaa', // Verde agua (persona 7)
            '#ffff00'  // Amarillo (persona 8)
        ];
        
        const color = colors[personIndex % colors.length];
        
        // Configurar estilo según si la persona es reconocida o no
        if (face.code === 'UNKNOWN') {
            this.faceMeshCtx.strokeStyle = '#ff0000'; // Rojo para desconocidos
            this.faceMeshCtx.fillStyle = 'rgba(255, 0, 0, 0.1)'; // Fondo rojo transparente
            this.faceMeshCtx.setLineDash([10, 5]); // Línea punteada para desconocidos
        } else {
            this.faceMeshCtx.strokeStyle = color;
            this.faceMeshCtx.fillStyle = this.hexToRgba(color, 0.1);
            this.faceMeshCtx.setLineDash([]); // Línea sólida para reconocidos
        }
        
        this.faceMeshCtx.lineWidth = 3;
        this.faceMeshCtx.shadowColor = color;
        this.faceMeshCtx.shadowBlur = 5;
        
        // Dibujar rectángulo
        this.faceMeshCtx.strokeRect(x, y, width, height);
        
        // Dibujar esquinas reforzadas (estilo futurista)
        this.drawCorners(x, y, width, height, color);
        
        // Dibujar información de la persona
        this.drawPersonInfo(face, x, y, width, color, personIndex);
    }

    drawCorners(x, y, width, height, color) {
        const cornerLength = 20;
        const cornerWidth = 4;
        
        this.faceMeshCtx.strokeStyle = color;
        this.faceMeshCtx.lineWidth = cornerWidth;
        this.faceMeshCtx.setLineDash([]);
        
        // Esquina superior izquierda
        this.faceMeshCtx.beginPath();
        this.faceMeshCtx.moveTo(x, y + cornerLength);
        this.faceMeshCtx.lineTo(x, y);
        this.faceMeshCtx.lineTo(x + cornerLength, y);
        this.faceMeshCtx.stroke();
        
        // Esquina superior derecha
        this.faceMeshCtx.beginPath();
       this.faceMeshCtx.moveTo(x + width - cornerLength, y);
       this.faceMeshCtx.lineTo(x + width, y);
       this.faceMeshCtx.lineTo(x + width, y + cornerLength);
       this.faceMeshCtx.stroke();
       
       // Esquina inferior izquierda
       this.faceMeshCtx.beginPath();
       this.faceMeshCtx.moveTo(x, y + height - cornerLength);
       this.faceMeshCtx.lineTo(x, y + height);
       this.faceMeshCtx.lineTo(x + cornerLength, y + height);
       this.faceMeshCtx.stroke();
       
       // Esquina inferior derecha
       this.faceMeshCtx.beginPath();
       this.faceMeshCtx.moveTo(x + width - cornerLength, y + height);
       this.faceMeshCtx.lineTo(x + width, y + height);
       this.faceMeshCtx.lineTo(x + width, y + height - cornerLength);
       this.faceMeshCtx.stroke();
   }

   drawPersonInfo(face, x, y, width, color, personIndex) {
       // Configurar texto
       this.faceMeshCtx.font = 'bold 14px Segoe UI';
       this.faceMeshCtx.fillStyle = color;
       this.faceMeshCtx.strokeStyle = '#000000';
       this.faceMeshCtx.lineWidth = 3;
       this.faceMeshCtx.textAlign = 'left';
       
       // Posición del texto (arriba del cuadro)
       const textX = x;
       const textY = y - 10;
       
       // Información a mostrar
       let displayText = '';
       if (face.code === 'UNKNOWN') {
           displayText = `👤 Desconocido`;
       } else {
           const confidence = (face.confidence * 100).toFixed(0);
           displayText = `👤 ${face.name} (${confidence}%)`;
       }
       
       // Dibujar fondo del texto
       const textMetrics = this.faceMeshCtx.measureText(displayText);
       const textWidth = textMetrics.width;
       const textHeight = 20;
       
       this.faceMeshCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
       this.faceMeshCtx.fillRect(textX - 2, textY - textHeight + 2, textWidth + 4, textHeight);
       
       // Dibujar contorno del texto
       this.faceMeshCtx.strokeText(displayText, textX, textY);
       
       // Dibujar texto principal
       this.faceMeshCtx.fillStyle = color;
       this.faceMeshCtx.fillText(displayText, textX, textY);
       
       // ID de persona (número en esquina superior derecha)
       this.faceMeshCtx.font = 'bold 16px Segoe UI';
       this.faceMeshCtx.textAlign = 'center';
       
       const idX = x + width - 15;
       const idY = y + 20;
       const personId = personIndex + 1;
       
       // Círculo de fondo para el ID
       this.faceMeshCtx.fillStyle = color;
       this.faceMeshCtx.beginPath();
       this.faceMeshCtx.arc(idX, idY, 12, 0, 2 * Math.PI);
       this.faceMeshCtx.fill();
       
       // Número del ID
       this.faceMeshCtx.fillStyle = '#000000';
       this.faceMeshCtx.fillText(personId.toString(), idX, idY + 5);
   }

   hexToRgba(hex, alpha) {
       const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
       if (result) {
           const r = parseInt(result[1], 16);
           const g = parseInt(result[2], 16);
           const b = parseInt(result[3], 16);
           return `rgba(${r}, ${g}, ${b}, ${alpha})`;
       }
       return `rgba(0, 255, 65, ${alpha})`;
   }

   clearFaceMesh() {
       if (this.faceMeshCtx && this.faceMeshCanvas) {
           this.faceMeshCtx.clearRect(0, 0, this.faceMeshCanvas.width, this.faceMeshCanvas.height);
       }
   }

   // FUNCIÓN ACTUALIZADA PARA TOGGLE CUADROS
   toggleFaceMesh() {
       this.showFaceMesh = !this.showFaceMesh;
       const button = document.getElementById('toggleMeshBtn');
       
       if (this.showFaceMesh) {
           button.textContent = '👁️ Ocultar Cuadros';
           button.classList.remove('mesh-hidden');
           this.updateStatus('Cuadros de detección activados', 'info');
       } else {
           button.textContent = '👁️ Mostrar Cuadros';
           button.classList.add('mesh-hidden');
           this.clearFaceMesh(); // Limpiar cuadros actuales
           this.updateStatus('Cuadros de detección desactivados', 'info');
       }
   }

   displayRecognitionResults(result) {
       const resultsContainer = document.getElementById('recognitionResults');
       
       if (result.faces.length === 0) {
           resultsContainer.innerHTML = '<div class="no-faces">No se detectaron rostros conocidos</div>';
           return;
       }
       
       let html = `<div class="faces-detected">Rostros detectados: ${result.total_faces}</div>`;
       
       result.faces.forEach((face, index) => {
           const confidencePercent = (face.confidence * 100).toFixed(1);
           const personNumber = index + 1;
           
           // Colores para coincidencia visual con cuadros
           const colors = [
               '#00ff41', '#ff0066', '#0099ff', '#ffaa00',
               '#aa00ff', '#ff3300', '#00ffaa', '#ffff00'
           ];
           const color = colors[index % colors.length];
           
           html += `
               <div class="recognized-face" style="border-left: 4px solid ${color};">
                   <div class="face-info">
                       <strong style="color: ${color};">👤 ${face.name}</strong><br>
                       <small>Código: ${face.code}</small><br>
                       <small>Confianza: ${confidencePercent}%</small><br>
                       <small style="color: ${color};">Persona ${personNumber}</small>
                   </div>
                   <div class="face-status">${face.code === 'UNKNOWN' ? '❓' : '✅'}</div>
               </div>
           `;
       });
       
       resultsContainer.innerHTML = html;
       
       // Actualizar contador
       document.getElementById('attendanceCount').textContent = result.faces.filter(f => f.code !== 'UNKNOWN').length;
   }

   async autoRecordAttendance(faces) {
       try {
           const response = await fetch('http://127.0.0.1:5000/api/attendance', {
               method: 'POST',
               headers: {
                   'Content-Type': 'application/json',
               },
               body: JSON.stringify({
                   faces: faces
               })
           });
           
           const result = await response.json();
           
           if (result.success) {
               this.updateStatus(result.message, 'success');
           }
           
       } catch (error) {
           console.error('Error registrando asistencia:', error);
       }
   }

   clearRecognitionResults() {
       document.getElementById('recognitionResults').innerHTML = '<div class="no-faces">Inicie el reconocimiento para detectar rostros</div>';
       document.getElementById('attendanceCount').textContent = '0';
   }

   async viewTodayAttendance() {
       try {
           const today = new Date().toISOString().split('T')[0];
           const records = await ipcRenderer.invoke('load-attendance', today);
           
           if (records.length === 0) {
               this.showAlert('No hay registros de asistencia para hoy.');
               return;
           }
           
           let message = `Asistencia de hoy (${today}):\n\n`;
           records.forEach(record => {
               message += `• ${record.name} (${record.code}) - ${record.time}\n`;
           });
           
           this.showAlert(message);
           
       } catch (error) {
           this.showAlert('Error al cargar asistencia: ' + error.message);
       }
   }

   async exitApplication() {
       const shouldExit = await ipcRenderer.invoke('show-exit-dialog');
       if (shouldExit) {
           await ipcRenderer.invoke('exit-app');
       }
   }

   showAlert(message) {
       alert(message);
   }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
   new FacialRecognitionRenderer();
});