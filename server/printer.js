const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const log = require('electron-log');
const fs = require('fs');
const path = require('path');
const os = require('os');

class PrinterService {
    constructor() {
        // Usar una ruta escribible para la configuración
        this.configPath = this.getConfigPath();
        log.info('Config path:', this.configPath);
        this.loadConfig();
    }

    getConfigPath() {
        // Intentar obtener el path de userData de Electron
        try {
            const { app } = require('electron');
            if (app && app.getPath) {
                const userDataPath = app.getPath('userData');
                log.info('Usando userData de Electron:', userDataPath);
                return path.join(userDataPath, 'settings.json');
            }
        } catch (e) {
            log.info('No se pudo obtener userData de Electron, usando fallback');
        }

        // Fallback: usar directorio en el home del usuario
        const configDir = path.join(os.homedir(), '.cloudsuite-printer');
        log.info('Usando directorio de configuración:', configDir);
        return path.join(configDir, 'settings.json');
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                log.info('Configuración cargada:', this.config);
            } else {
                this.config = {
                    printerName: null,
                    printerType: 'EPSON',
                    interface: 'printer',
                    width: 48,
                    characterSet: 'PC437_USA'
                };
                this.saveConfig();
            }
        } catch (error) {
            log.error('Error cargando configuración:', error);
            this.config = {
                printerName: null,
                printerType: 'EPSON',
                interface: 'printer',
                width: 48,
                characterSet: 'PC437_USA'
            };
        }
    }

    saveConfig() {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
            log.info('Configuración guardada');
        } catch (error) {
            log.error('Error guardando configuración:', error);
        }
    }

    getConfig() {
        return this.config;
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.saveConfig();
    }

    createPrinter() {
        // Crear ThermalPrinter que escribe a un archivo temporal
        const tempFile = path.join(os.tmpdir(), `print_${Date.now()}.raw`);

        const thermalPrinter = new ThermalPrinter({
            type: PrinterTypes[this.config.printerType] || PrinterTypes.EPSON,
            interface: tempFile, // Escribe a archivo
            width: this.config.width,
            characterSet: this.config.characterSet,
            options: {
                timeout: 5000
            }
        });

        // Guardar referencia al archivo temporal
        thermalPrinter._tempFile = tempFile;

        return thermalPrinter;
    }

    async sendToPrinter(buffer) {
        if (!this.config.printerName) {
            throw new Error('No hay impresora configurada');
        }

        const tempFile = path.join(os.tmpdir(), `print_${Date.now()}.raw`);

        try {
            // Agregar bytes nulos al inicio como padding para evitar perdida de datos
            const padding = Buffer.alloc(64, 0x00);
            const fullBuffer = Buffer.concat([padding, buffer]);

            // Escribir buffer al archivo temporal
            fs.writeFileSync(tempFile, fullBuffer);

            // Enviar a la impresora usando lp (macOS/Linux) o lpr
            if (process.platform === 'darwin' || process.platform === 'linux') {
                await execAsync(`lp -d "${this.config.printerName}" -o raw "${tempFile}"`);
            } else if (process.platform === 'win32') {
                // En Windows, enviar RAW real al spooler (ESC/POS) con WinSpool
                await this.sendRawToWindowsPrinter(tempFile, this.config.printerName);
            }

            log.info('Datos enviados a la impresora');
        } finally {
            // Limpiar archivo temporal
            try {
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
            } catch (e) {
                log.warn('No se pudo eliminar archivo temporal:', e.message);
            }
        }
    }

    async sendRawToWindowsPrinter(tempFile, printerName) {
        const psScript = `
            $ErrorActionPreference = 'Stop'
            $printerName = $env:CSP_PRINTER_NAME
            $filePath = $env:CSP_TEMP_FILE

            if (-not $printerName) { throw 'CSP_PRINTER_NAME no definido' }
            if (-not (Test-Path -LiteralPath $filePath)) { throw "Archivo no encontrado: $filePath" }

            Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            return false;
        }

        var di = new DOCINFOA
        {
            pDocName = "CloudSuite Ticket",
            pDataType = "RAW"
        };

        IntPtr unmanagedBytes = IntPtr.Zero;
        try
        {
            if (!StartDocPrinter(hPrinter, 1, di)) return false;
            if (!StartPagePrinter(hPrinter)) return false;

            unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
            Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);

            int written;
            bool ok = WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written);
            EndPagePrinter(hPrinter);
            EndDocPrinter(hPrinter);
            return ok && written == bytes.Length;
        }
        finally
        {
            if (unmanagedBytes != IntPtr.Zero) Marshal.FreeCoTaskMem(unmanagedBytes);
            ClosePrinter(hPrinter);
        }
    }
}
"@

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $ok = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
            if (-not $ok) {
                $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
                throw "No se pudo enviar RAW a '$printerName'. Win32Error: $err"
            }
        `;

        const psFile = path.join(os.tmpdir(), `cloudsuite_raw_${Date.now()}.ps1`);

        try {
            fs.writeFileSync(psFile, psScript, 'utf8');

            await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
                env: {
                    ...process.env,
                    CSP_PRINTER_NAME: printerName,
                    CSP_TEMP_FILE: tempFile
                },
                maxBuffer: 1024 * 1024,
                windowsHide: true
            });
        } finally {
            try {
                if (fs.existsSync(psFile)) {
                    fs.unlinkSync(psFile);
                }
            } catch (e) {
                log.warn('No se pudo eliminar script temporal de PowerShell:', e.message);
            }
        }
    }

    async listPrinters() {
        try {
            // En macOS, obtener la lista de impresoras del sistema
            if (process.platform === 'darwin') {
                try {
                    const { stdout } = await execAsync('lpstat -p 2>/dev/null || echo ""');
                    const lines = stdout.split('\n');
                    const printerNames = lines
                        .filter(line => line.startsWith('printer'))
                        .map(line => line.split(' ')[1]);
                    return printerNames;
                } catch (err) {
                    log.warn('No se pudo obtener lista de impresoras del sistema:', err.message);
                    return [];
                }
            }

            // En Windows, usar wmic o powershell
            if (process.platform === 'win32') {
                const commands = [
                    // Método recomendado en Windows 10/11
                    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"',
                    // Fallback si Get-CimInstance no está disponible por política
                    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"',
                    // Último fallback para equipos antiguos
                    'wmic printer get name'
                ];

                for (const command of commands) {
                    try {
                        const { stdout } = await execAsync(command);
                        const printers = this.parsePrinterListOutput(stdout);
                        if (printers.length > 0) {
                            log.info(`Impresoras detectadas (${printers.length}) usando: ${command.split(' ')[0]}`);
                            return printers;
                        }
                    } catch (err) {
                        log.warn(`Falló comando de listado de impresoras: ${command.split(' ')[0]} - ${err.message}`);
                    }
                }

                log.warn('No se encontraron impresoras en Windows con los métodos disponibles');
                return [];
            }

            // En Linux, usar CUPS
            if (process.platform === 'linux') {
                try {
                    const { stdout } = await execAsync('lpstat -a 2>/dev/null || echo ""');
                    const lines = stdout.split('\n')
                        .map(line => line.trim())
                        .filter(Boolean)
                        .map(line => line.split(' ')[0])
                        .filter(Boolean);

                    return [...new Set(lines)];
                } catch (err) {
                    log.warn('No se pudo obtener lista de impresoras en Linux:', err.message);
                    return [];
                }
            }

            return [];
        } catch (error) {
            log.error('Error listando impresoras:', error);
            return [];
        }
    }

    parsePrinterListOutput(stdout) {
        if (!stdout) return [];

        const text = String(stdout).trim();
        if (!text) return [];

        // Intentar parsear JSON (salida de PowerShell + ConvertTo-Json)
        try {
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed) ? parsed : [parsed];
            return [...new Set(list
                .map(item => String(item || '').trim())
                .filter(name => name && name.toLowerCase() !== 'name'))];
        } catch (_) {
            // Si no es JSON, asumir salida tabular (wmic)
            const lines = text
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line && line.toLowerCase() !== 'name');
            return [...new Set(lines)];
        }
    }

    async printInvoice(data) {
        // Modo simulación: Si no hay impresora configurada, solo mostrar en log
        if (!this.config.printerName) {
            log.info('═══════════════════════════════════════════════');
            log.info('MODO SIMULACION - Sin impresora configurada');
            log.info('═══════════════════════════════════════════════');
            log.info('');
            log.info(`          ${data.companyName || 'CloudSuite Pro'}`);
            if (data.companyAddress) log.info(`          ${data.companyAddress}`);
            if (data.companyRnc) log.info(`          RNC: ${data.companyRnc}`);
            if (data.companyPhone) log.info(`          Tel: ${data.companyPhone}`);
            log.info('-----------------------------------------------');
            // Fecha (izquierda) y Hora (derecha)
            const dateObj = new Date(data.date);
            const dateStr = dateObj.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
            log.info(`${dateStr.padEnd(30)}${timeStr}`);
            log.info(`No. Factura: ${data.invoiceNumber || 'N/A'}`);
            log.info(`Cliente: ${data.customerName || 'Consumidor Final'}`);
            if (data.customerRnc) log.info(`RNC/Cedula: ${data.customerRnc}`);
            if (data.invoiceType) log.info(`Tipo: ${data.invoiceType}`);
            if (data.ncf) log.info(`NCF: ${data.ncf}`);
            if (data.cashierName) log.info(`Cajero(a): ${data.cashierName}`);
            log.info('-----------------------------------------------');
            log.info('Cant  Descripcion        Precio     Total');
            log.info('-----------------------------------------------');

            const nameMaxChars = 18;
            for (const item of data.items || []) {
                const qty = item.quantity || 1;
                const unitPrice = item.price || 0;
                const itemTotal = item.total;
                const productName = item.name || item.description || '';

                // Dividir nombre en líneas si es necesario
                const nameLine1 = productName.substring(0, nameMaxChars).padEnd(nameMaxChars);
                const nameLine2 = productName.length > nameMaxChars
                    ? productName.substring(nameMaxChars, nameMaxChars * 2).trim()
                    : '';

                const qtyStr = qty.toString().padEnd(5);
                const priceStr = this.formatMoney(unitPrice).padStart(8);
                const totalStr = this.formatMoney(itemTotal).padStart(10);

                // Primera línea
                log.info(`${qtyStr} ${nameLine1} ${priceStr} ${totalStr}`);

                // Segunda línea del nombre si existe
                if (nameLine2) {
                    log.info(`      ${nameLine2.padEnd(nameMaxChars)}`);
                }
            }

            log.info('-----------------------------------------------');
            if (data.subtotal !== undefined) {
                log.info(`                  Subtotal: RD$${this.formatMoney(data.subtotal)}`);
            }
            if (data.discount && data.discount > 0) {
                log.info(`                 Descuento: -RD$${this.formatMoney(data.discount)}`);
            }
            if (data.tax !== undefined) {
                const itbisRate = data.itbisRate || 18;
                log.info(`             ITBIS (${itbisRate}%): RD$${this.formatMoney(data.tax)}`);
            }
            log.info('===============================================');
            log.info(`              TOTAL: RD$${this.formatMoney(data.total)}`);
            log.info('===============================================');
            if (data.paymentMethod) {
                log.info(`Metodo de pago: ${data.paymentMethod}`);
            }
            log.info('');
            log.info('          Gracias por su compra!');
            if (data.footer) log.info(`          ${data.footer}`);
            log.info('');
            log.info('Factura simulada exitosamente');
            log.info('');
            return;
        }

        // Modo real: Imprimir en impresora térmica
        const printer = this.createPrinter();

        try {
            // Header - Nombre de empresa
            printer.alignCenter();
            printer.bold(true);
            printer.println(data.companyName || 'CloudSuite Pro');
            printer.bold(false);

            // Datos de la empresa
            if (data.companyAddress) printer.println(data.companyAddress);
            if (data.companyPhone) printer.println(`Tel: ${data.companyPhone}`);
            if (data.companyRnc) printer.println(`RNC: ${data.companyRnc}`);

            printer.drawLine();

            // Título FACTURA centrado
            printer.alignCenter();
            printer.bold(true);
            printer.println('FACTURA');
            printer.bold(false);

            printer.drawLine();

            // Info factura - nuevo orden
            printer.alignLeft();

            // Fecha (izquierda) y Hora (derecha)
            const dateObj = new Date(data.date);
            const dateStr = dateObj.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
            const printerWidth = this.config.width || 48;
            const dateTimeLine = dateStr.padEnd(printerWidth - timeStr.length) + timeStr;
            printer.println(dateTimeLine);

            // Número de factura
            printer.bold(true);
            printer.println(`No. Factura: ${data.invoiceNumber || 'N/A'}`);
            printer.bold(false);

            // Cliente
            printer.println(`Cliente: ${data.customerName || 'Consumidor Final'}`);

            // RNC del cliente
            if (data.customerRnc) {
                printer.println(`RNC/Cedula: ${data.customerRnc}`);
            }

            // Tipo de factura (nombre legible)
            if (data.invoiceType) {
                printer.println(`Tipo: ${data.invoiceType}`);
            }

            // NCF
            if (data.ncf) {
                printer.println(`NCF: ${data.ncf}`);
            }

            // Cajero(a)
            if (data.cashierName) {
                printer.println(`Cajero(a): ${data.cashierName}`);
            }

            printer.drawLine();

            // Encabezado de items
            // Ancho total = 48 caracteres
            // Cant(4) + espacio(1) + Descripcion(16) + espacio(3) + Precio(9) + espacio(1) + Total(14)
            const priceColWidth = 9;   // Ancho columna Precio
            const totalColWidth = 14;  // Ancho columna Total (alineado con subtotal)
            const headerQty = 'Cant'.padEnd(4);
            const headerDesc = 'Descripcion'.padEnd(16);
            const headerPrice = 'Precio'.padEnd(priceColWidth);   // Alineado izquierda
            const headerTotal = 'Total'.padStart(totalColWidth);  // Alineado derecha
            printer.println(`${headerQty} ${headerDesc}   ${headerPrice} ${headerTotal}`);
            printer.drawLine();

            // Items
            const nameMaxChars = 16; // Caracteres máximos por línea para el nombre

            for (const item of data.items || []) {
                const qty = item.quantity || 1;
                const unitPrice = item.price || 0;
                const itemTotal = item.total;
                const productName = item.name || item.description || '';

                // Formatear campos
                const qtyStr = qty.toString().padEnd(4);
                const priceStr = this.formatMoney(unitPrice).padEnd(priceColWidth);   // Alineado izquierda
                const totalStr = this.formatMoney(itemTotal).padStart(totalColWidth); // Alineado derecha

                // Dividir nombre en líneas si es necesario
                const nameLine1 = productName.substring(0, nameMaxChars).padEnd(nameMaxChars);
                const nameLine2 = productName.length > nameMaxChars
                    ? productName.substring(nameMaxChars, nameMaxChars * 2).trim()
                    : '';

                // Primera línea con cantidad, nombre, precio y total (3 espacios entre desc y precio)
                printer.println(`${qtyStr} ${nameLine1}   ${priceStr} ${totalStr}`);

                // Segunda línea del nombre si existe
                if (nameLine2) {
                    printer.println(`     ${nameLine2}`);
                }
            }

            printer.drawLine();

            // Totales
            printer.alignRight();

            if (data.subtotal !== undefined) {
                printer.println(`Subtotal: RD$${this.formatMoney(data.subtotal)}`);
            }

            if (data.discount && data.discount > 0) {
                printer.println(`Descuento: -RD$${this.formatMoney(data.discount)}`);
            }

            if (data.tax !== undefined) {
                const itbisRate = data.itbisRate || 18;
                printer.println(`ITBIS (${itbisRate}%): RD$${this.formatMoney(data.tax)}`);
            }

            printer.drawLine();
            printer.bold(true);
            printer.setTextDoubleHeight();
            printer.println(`TOTAL: RD$${this.formatMoney(data.total)}`);
            printer.setTextNormal();
            printer.bold(false);

            // Método de pago
            if (data.paymentMethod) {
                printer.newLine();
                printer.println(`Metodo de pago: ${data.paymentMethod}`);
            }

            // Footer
            printer.alignCenter();
            printer.newLine();
            printer.println('Gracias por su compra!');
            if (data.footer) {
                printer.println(data.footer);
            }
            printer.cut();

            // Obtener el buffer y enviarlo a la impresora
            const buffer = printer.getBuffer();
            await this.sendToPrinter(buffer);
            log.info('Factura impresa exitosamente');
        } catch (error) {
            log.error('Error imprimiendo factura:', error);
            throw error;
        }
    }

    async printTicket(data) {
        if (!this.config.printerName) {
            log.info('MODO SIMULACION - Ticket:', data);
            return;
        }

        const printer = this.createPrinter();

        try {
            printer.alignCenter();
            printer.setTextSize(1, 1);
            printer.bold(true);
            printer.println(data.title || 'TICKET');
            printer.bold(false);
            printer.setTextSize(0, 0);
            printer.println(this.formatDate(new Date()));
            printer.drawLine();

            printer.alignLeft();
            if (data.content) {
                printer.println(data.content);
            }

            printer.newLine();
            printer.alignCenter();
            printer.cut();

            const buffer = printer.getBuffer();
            await this.sendToPrinter(buffer);
            log.info('Ticket impreso exitosamente');
        } catch (error) {
            log.error('Error imprimiendo ticket:', error);
            throw error;
        }
    }

    async printReport(data) {
        if (!this.config.printerName) {
            log.info('MODO SIMULACION - Reporte:', data);
            return;
        }

        const printer = this.createPrinter();

        try {
            // Header
            printer.alignCenter();
            printer.bold(true);
            printer.println(data.title || 'REPORTE');
            printer.bold(false);
            printer.println(this.formatDate(new Date()));
            printer.drawLine();

            // Content
            printer.alignLeft();
            if (data.lines && Array.isArray(data.lines)) {
                for (const line of data.lines) {
                    if (line.type === 'line') {
                        printer.drawLine();
                    } else if (line.type === 'title') {
                        printer.bold(true);
                        printer.println(line.text || '');
                        printer.bold(false);
                    } else {
                        printer.println(line.text || '');
                    }
                }
            }

            printer.newLine();
            printer.cut();

            const buffer = printer.getBuffer();
            await this.sendToPrinter(buffer);
            log.info('Reporte impreso exitosamente');
        } catch (error) {
            log.error('Error imprimiendo reporte:', error);
            throw error;
        }
    }

    async openCashDrawer() {
        if (!this.config.printerName) {
            log.info('MODO SIMULACION - Abriendo cajon');
            return;
        }

        const printer = this.createPrinter();

        try {
            printer.openCashDrawer();
            const buffer = printer.getBuffer();
            await this.sendToPrinter(buffer);
            log.info('Cajon abierto');
        } catch (error) {
            log.error('Error abriendo cajon:', error);
            throw error;
        }
    }

    async testPrint() {
        if (!this.config.printerName) {
            log.info('===============================================');
            log.info('        MODO SIMULACION - TEST DE IMPRESION');
            log.info('===============================================');
            log.info('        CloudSuite Printer Service');
            log.info(`        ${this.formatDate(new Date())}`);
            log.info('-----------------------------------------------');
            log.info('        Si puede leer esto,');
            log.info('        la impresora funciona correctamente!');
            log.info('===============================================');
            log.info('Test de impresion simulado exitosamente');
            return;
        }

        const printer = this.createPrinter();

        try {
            printer.alignCenter();
            printer.bold(true);
            printer.println('TEST DE IMPRESION');
            printer.bold(false);
            printer.println('CloudSuite Printer Service');
            printer.println(this.formatDate(new Date()));
            printer.drawLine();
            printer.println('Si puede leer esto,');
            printer.println('la impresora funciona correctamente!');
            printer.newLine();
            printer.cut();

            const buffer = printer.getBuffer();
            await this.sendToPrinter(buffer);
            log.info('Test de impresion ejecutado');
        } catch (error) {
            log.error('Error en test de impresion:', error);
            throw error;
        }
    }

    // Utilidades
    formatDate(date) {
        const d = new Date(date);
        return d.toLocaleString('es-DO', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatMoney(amount) {
        return parseFloat(amount || 0).toLocaleString('es-DO', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    truncate(str, length) {
        if (!str) return '';
        return str.length > length ? str.substring(0, length - 3) + '...' : str;
    }
}

module.exports = PrinterService;
