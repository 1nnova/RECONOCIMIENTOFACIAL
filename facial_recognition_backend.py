import numpy as np
import json
import os
from datetime import datetime
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import io
from PIL import Image
import mediapipe as mp

class FacialRecognitionSystem:
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app)
        
        # Diccionarios para almacenar información de estudiantes
        self.students_data = {}
        self.face_features = {}
        
        # Configuraciones
        self.similarity_threshold = 0.7
        
        # Inicializar MediaPipe para detección de rostros
        self.mp_face_detection = mp.solutions.face_detection
        self.mp_face_mesh = mp.solutions.face_mesh
        
        self.face_detection = self.mp_face_detection.FaceDetection(
            model_selection=0, min_detection_confidence=0.5
        )
        
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=5,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        # Cargar estudiantes registrados
        self.load_students()
        
        # Configurar rutas de la API
        self.setup_routes()
    
    def extract_face_landmarks_features(self, image_np, face_landmarks):
        """Extraer características basadas en landmarks faciales"""
        try:
            height, width = image_np.shape[:2]
            
            # Extraer coordenadas normalizadas de puntos clave
            key_points = [
                # Puntos del contorno facial
                10, 151, 9, 8, 168,  # Centro y nariz
                33, 133, 362, 398,   # Esquinas de ojos
                61, 291,             # Comisuras de boca
                13, 14, 15, 16,      # Barbilla
                21, 251              # Mejillas
            ]
            
            features = []
            
            for point_idx in key_points:
                if point_idx < len(face_landmarks.landmark):
                    landmark = face_landmarks.landmark[point_idx]
                    features.extend([landmark.x, landmark.y, landmark.z])
            
            # Calcular distancias entre puntos clave
            if len(face_landmarks.landmark) > 168:
                # Distancia entre ojos
                left_eye = face_landmarks.landmark[33]
                right_eye = face_landmarks.landmark[362]
                eye_distance = np.sqrt((left_eye.x - right_eye.x)**2 + (left_eye.y - right_eye.y)**2)
                
                # Proporción facial (alto/ancho)
                top_face = face_landmarks.landmark[10]
                bottom_face = face_landmarks.landmark[152]
                face_height = abs(top_face.y - bottom_face.y)
                
                features.extend([eye_distance, face_height])
            
            return np.array(features)
            
        except Exception as e:
            print(f"Error extrayendo características de landmarks: {e}")
            return None
    
    def load_students(self):
        """Cargar estudiantes registrados"""
        students_dir = "data/students"
        if not os.path.exists(students_dir):
            print("📁 Directorio de estudiantes no encontrado, creando...")
            os.makedirs(students_dir, exist_ok=True)
            return
        
        print("🔄 Cargando estudiantes registrados...")
        
        for student_code in os.listdir(students_dir):
            student_path = os.path.join(students_dir, student_code)
            if os.path.isdir(student_path):
                student_info = self.process_student(student_path, student_code)
                if student_info:
                    self.students_data[student_code] = student_info
                    
                    # Extraer características
                    student_features = self.extract_student_features(student_path)
                    if student_features:
                        self.face_features[student_code] = student_features
                        print(f"✅ Procesado: {student_info['name']} ({student_info['code']}) - {len(student_features)} características")
        
        print(f"✅ {len(self.students_data)} estudiantes cargados")
    
    def process_student(self, student_path, student_code):
        """Procesar información de un estudiante"""
        info_file = os.path.join(student_path, "info.json")
        if not os.path.exists(info_file):
            return None
        
        try:
            with open(info_file, 'r', encoding='utf-8') as f:
                student_info = json.load(f)
            
            return {
                'code': student_info['code'],
                'name': student_info['name'],
                'registration_date': student_info['registrationDate'],
                'frames_count': student_info.get('framesCount', 0)
            }
        except Exception as e:
            print(f"❌ Error procesando estudiante {student_code}: {e}")
            return None
    
    def extract_student_features(self, student_path):
        """Extraer características de todas las imágenes de un estudiante"""
        features_list = []
        
        for filename in os.listdir(student_path):
            if filename.endswith(('.jpg', '.jpeg', '.png')):
                image_path = os.path.join(student_path, filename)
                
                try:
                    # Cargar imagen con PIL
                    image = Image.open(image_path)
                    image_np = np.array(image)
                    
                    # Detectar rostros con MediaPipe
                    results = self.face_mesh.process(image_np)
                    
                    if results.multi_face_landmarks:
                        for face_landmarks in results.multi_face_landmarks:
                            features = self.extract_face_landmarks_features(image_np, face_landmarks)
                            if features is not None and len(features) > 0:
                                features_list.append(features)
                                
                except Exception as e:
                    print(f"⚠️  Error procesando imagen {filename}: {e}")
                    continue
        
        return features_list
    
    def calculate_similarity(self, features1, features2):
        """Calcular similitud entre vectores de características"""
        try:
            # Asegurar que ambos vectores tengan el mismo tamaño
            min_len = min(len(features1), len(features2))
            features1 = features1[:min_len]
            features2 = features2[:min_len]
            
            # Normalizar vectores
            norm1 = np.linalg.norm(features1)
            norm2 = np.linalg.norm(features2)
            
            if norm1 == 0 or norm2 == 0:
                return 0
            
            features1 = features1 / norm1
            features2 = features2 / norm2
            
            # Calcular similitud coseno
            similarity = np.dot(features1, features2)
            
            # Convertir a rango 0-1
            similarity = (similarity + 1) / 2
            
            return similarity
            
        except Exception as e:
            print(f"Error calculando similitud: {e}")
            return 0
    
    def recognize_face_by_landmarks(self, face_landmarks, image_np):
        """Reconocer rostro usando landmarks de MediaPipe"""
        if len(self.face_features) == 0:
            return None, 0
        
        try:
            # Extraer características del rostro actual
            current_features = self.extract_face_landmarks_features(image_np, face_landmarks)
            if current_features is None:
                return None, 0
            
            best_match = None
            best_similarity = 0
            
            # Comparar con todos los estudiantes
            for student_code, student_features_list in self.face_features.items():
                similarities = []
                
                for stored_features in student_features_list:
                    similarity = self.calculate_similarity(current_features, stored_features)
                    similarities.append(similarity)
                
                if similarities:
                    max_similarity = max(similarities)
                    
                    if max_similarity > best_similarity:
                        best_similarity = max_similarity
                        best_match = student_code
            
            # Verificar umbral
            if best_similarity > self.similarity_threshold and best_match:
                student_info = self.students_data[best_match]
                return student_info, best_similarity
            
            return None, best_similarity
            
        except Exception as e:
            print(f"❌ Error en reconocimiento: {e}")
            return None, 0
    
    def setup_routes(self):
        """Configurar rutas de la API"""
        
        @self.app.route('/api/recognize_with_mesh', methods=['POST'])
        def recognize_with_mesh():
            """Reconocer rostros y obtener malla facial"""
            try:
                data = request.json
                image_data = data['image']
                
                # Decodificar imagen base64
                image_bytes = base64.b64decode(image_data.split(',')[1])
                image = Image.open(io.BytesIO(image_bytes))
                image_np = np.array(image)
                
                # Detectar rostros y malla con MediaPipe
                detection_results = self.face_detection.process(image_np)
                mesh_results = self.face_mesh.process(image_np)
                
                recognized_faces = []
                face_meshes = []
                
                # Procesar detecciones de rostros
                if detection_results.detections:
                    height, width = image_np.shape[:2]
                    
                    for detection in detection_results.detections:
                        bbox = detection.location_data.relative_bounding_box
                        
                        # Convertir coordenadas relativas a píxeles
                        x = int(bbox.xmin * width)
                        y = int(bbox.ymin * height)
                        w = int(bbox.width * width)
                        h = int(bbox.height * height)
                        
                        # Buscar correspondencia en malla facial para reconocimiento
                        student_info = None
                        confidence = 0
                        
                        if mesh_results.multi_face_landmarks:
                            # Usar el primer landmark para reconocimiento
                            # (en una versión más avanzada podrías hacer matching por posición)
                            for face_landmarks in mesh_results.multi_face_landmarks:
                                student_info, confidence = self.recognize_face_by_landmarks(face_landmarks, image_np)
                                break  # Solo procesar el primer rostro por ahora
                        
                        if student_info and confidence > self.similarity_threshold:
                            recognized_faces.append({
                                'name': student_info['name'],
                                'code': student_info['code'],
                                'confidence': float(confidence),
                                'location': {
                                    'top': y,
                                    'right': x + w,
                                    'bottom': y + h,
                                    'left': x
                                }
                            })
                        else:
                            recognized_faces.append({
                                'name': 'Desconocido',
                                'code': 'UNKNOWN',
                                'confidence': float(confidence),
                                'location': {
                                    'top': y,
                                    'right': x + w,
                                    'bottom': y + h,
                                    'left': x
                                }
                            })
                
                # Procesar malla facial
                if mesh_results.multi_face_landmarks:
                    height, width = image_np.shape[:2]
                    
                    for face_landmarks in mesh_results.multi_face_landmarks:
                        landmarks = []
                        
                        for landmark in face_landmarks.landmark:
                            x = int(landmark.x * width)
                            y = int(landmark.y * height)
                            landmarks.append({'x': x, 'y': y})
                        
                        face_meshes.append({
                            'landmarks': landmarks,
                            'connections': self.get_face_connections()
                        })
                
                return jsonify({
                    'success': True,
                    'faces': recognized_faces,
                    'face_meshes': face_meshes,
                    'total_faces': len(recognized_faces)
                })
                
            except Exception as e:
                print(f"❌ Error en reconocimiento con malla: {e}")
                return jsonify({
                    'success': False,
                    'error': str(e)
                }), 500
        
        @self.app.route('/api/attendance', methods=['POST'])
        def record_attendance():
            """Registrar asistencia"""
            try:
                data = request.json
                recognized_faces = data['faces']
                
                today = datetime.now()
                date_str = today.strftime('%Y-%m-%d')
                time_str = today.strftime('%H:%M:%S')
                
                attendance_dir = f"data/attendance/{date_str}"
                os.makedirs(attendance_dir, exist_ok=True)
                
                attendance_file = os.path.join(attendance_dir, "records.json")
                
                if os.path.exists(attendance_file):
                    with open(attendance_file, 'r', encoding='utf-8') as f:
                        records = json.load(f)
                else:
                    records = []
                
                new_registrations = 0
                for face in recognized_faces:
                    if face['code'] != 'UNKNOWN':
                        already_registered = any(r['code'] == face['code'] for r in records)
                        
                        if not already_registered:
                            records.append({
                                'code': face['code'],
                                'name': face['name'],
                                'time': time_str,
                                'confidence': face['confidence'],
                                'status': 'present'
                            })
                            new_registrations += 1
                
                with open(attendance_file, 'w', encoding='utf-8') as f:
                    json.dump(records, f, indent=2, ensure_ascii=False)
                
                message = f'Asistencia registrada para {new_registrations} estudiantes nuevos'
                if new_registrations == 0:
                    message = 'Todos los estudiantes reconocidos ya están registrados hoy'
                
                return jsonify({
                    'success': True,
                    'message': message,
                    'date': date_str,
                    'time': time_str,
                    'new_registrations': new_registrations,
                    'total_present': len(records)
                })
                
            except Exception as e:
                print(f"❌ Error registrando asistencia: {e}")
                return jsonify({
                    'success': False,
                    'error': str(e)
                }), 500
        
        @self.app.route('/api/students/reload', methods=['POST'])
        def reload_students():
            """Recargar estudiantes"""
            try:
                self.students_data = {}
                self.face_features = {}
                self.load_students()
                
                return jsonify({
                    'success': True,
                    'message': f'{len(self.students_data)} estudiantes recargados',
                    'students_loaded': len(self.students_data)
                })
                
            except Exception as e:
                print(f"❌ Error recargando estudiantes: {e}")
                return jsonify({
                    'success': False,
                    'error': str(e)
                }), 500
        
        @self.app.route('/api/status', methods=['GET'])
        def get_status():
            """Obtener estado del sistema"""
            return jsonify({
                'success': True,
                'students_loaded': len(self.students_data),
                'system_ready': len(self.students_data) > 0,
                'similarity_threshold': self.similarity_threshold,
                'features_loaded': len(self.face_features)
            })
    
    def get_face_connections(self):
        """Conexiones de malla facial"""
        return [
            [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
            [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
            [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398, 362],
            [168, 8, 9, 10, 151, 195, 197, 196, 3, 51, 48, 115, 131, 134, 102, 48, 64],
            [61, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 61]
        ]
    
    def run(self, host='127.0.0.1', port=5000, debug=False):
        """Ejecutar servidor"""
        print(f"🚀 Iniciando servidor en http://{host}:{port}")
        print(f"📊 Estudiantes cargados: {len(self.students_data)}")
        print(f"🧠 Solo MediaPipe (sin OpenCV)")
        print("="*50)
        
        self.app.run(host=host, port=port, debug=debug, threaded=True)

if __name__ == '__main__':
    print("🤖 Sistema de Reconocimiento Facial - Solo MediaPipe")
    print("="*50)
    
    try:
        import mediapipe
        print("✅ MediaPipe verificado")
    except ImportError:
        print("❌ Instalando MediaPipe...")
        import subprocess
        import sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "mediapipe"])
    
    os.makedirs("data/students", exist_ok=True)
    os.makedirs("data/attendance", exist_ok=True)
    
    system = FacialRecognitionSystem()
    
    try:
        system.run(debug=True)
    except KeyboardInterrupt:
        print("\n👋 Cerrando servidor...")
    except Exception as e:
        print(f"❌ Error crítico: {e}")