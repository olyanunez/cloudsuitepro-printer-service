# CloudSuite Printer Service

Servicio de impresión para CloudSuite Pro que permite imprimir facturas y tickets en impresoras térmicas ESC/POS.

## Características

- ✅ Impresión en impresoras térmicas (Epson, Star, Bixolon, etc.)
- ✅ API REST local en puerto 9100
- ✅ Soporte para NCF de República Dominicana
- ✅ Apertura de cajón de dinero
- ✅ Auto-inicio con el sistema
- ✅ Configuración gráfica simple

## Requisitos

- Windows 10/11 o macOS 10.15+
- Impresora térmica compatible con ESC/POS
- Puerto USB o conexión de red

## Instalación

### Windows
1. Descarga `CloudSuite-Printer-Service-Setup-x.x.x.exe`
2. Ejecuta el instalador
3. Sigue el asistente de instalación
4. El servicio se iniciará automáticamente

### macOS
1. Descarga `CloudSuite-Printer-Service-x.x.x.dmg`
2. Abre el archivo DMG
3. Arrastra la app a Aplicaciones
4. Ejecuta la aplicación
5. Permite los permisos necesarios en Preferencias del Sistema

## Configuración

1. Busca el icono del servicio en la bandeja del sistema (tray)
2. Click derecho → Configuración
3. Selecciona tu impresora de la lista
4. Haz click en "Imprimir Prueba" para verificar

## API Endpoints

### Health Check
```bash
GET http://localhost:9100/health
```

### Listar Impresoras
```bash
GET http://localhost:9100/printers
```

### Imprimir Factura
```bash
POST http://localhost:9100/print/invoice
Content-Type: application/json

{
  "companyName": "Mi Empresa",
  "companyRnc": "123456789",
  "ncf": "B0100000001",
  "invoiceNumber": "001",
  "date": "2024-03-05",
  "customerName": "Cliente",
  "items": [
    {
      "name": "Producto 1",
      "quantity": 2,
      "price": 100,
      "total": 200
    }
  ],
  "subtotal": 200,
  "tax": 36,
  "total": 236
}
```

### Abrir Cajón
```bash
POST http://localhost:9100/open-drawer
```

## Impresoras Compatibles

- Epson TM-T20, TM-T88
- Star TSP650, TSP700
- Bixolon SRP-350, SRP-380
- Cualquier impresora compatible con ESC/POS

## Desarrollo

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Compilar para Windows
npm run build:win

# Compilar para macOS
npm run build:mac
```

## Soporte

Para soporte técnico, visita: https://docs.cloudsuitepro.online

## Licencia

MIT License
