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
        this.configPath = path.join(__dirname, '../config/settings.json');
        this.loadConfig();
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
                // En Windows usar print o powershell
                await execAsync(`print /D:"${this.config.printerName}" "${tempFile}"`);
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
                try {
                    const { stdout } = await execAsync('wmic printer get name');
                    const lines = stdout.split('\n')
                        .map(line => line.trim())
                        .filter(line => line && line !== 'Name');
                    return lines;
                } catch (err) {
                    log.warn('No se pudo obtener lista de impresoras del sistema:', err.message);
                    return [];
                }
            }

            return [];
        } catch (error) {
            log.error('Error listando impresoras:', error);
            return [];
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
            if (data.ncf) log.info(`NCF: ${data.ncf}`);
            log.info(`FACTURA: ${data.invoiceNumber || 'N/A'}`);
            log.info(`Fecha: ${this.formatDate(data.date)}`);
            log.info(`Cliente: ${data.customerName || 'Consumidor Final'}`);
            if (data.customerRnc) log.info(`RNC/Cedula: ${data.customerRnc}`);
            log.info('-----------------------------------------------');
            log.info('Cant  Descripcion              Total');
            log.info('-----------------------------------------------');

            for (const item of data.items || []) {
                const qty = item.quantity || 1;
                const unitPrice = item.price || 0;
                const itemTotal = item.total || (qty * unitPrice);
                const qtyStr = qty.toString().padEnd(5);
                const name = this.truncate(item.name || item.description || '', 20).padEnd(23);
                log.info(`${qtyStr} ${name} RD$${this.formatMoney(itemTotal)}`);
                if (qty > 1 && unitPrice) {
                    log.info(`      @ RD$${this.formatMoney(unitPrice)} c/u`);
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
                log.info(`             ITBIS (18%): RD$${this.formatMoney(data.tax)}`);
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
            if (data.companyRnc) printer.println(`RNC: ${data.companyRnc}`);
            if (data.companyPhone) printer.println(`Tel: ${data.companyPhone}`);

            printer.drawLine();

            // Info factura
            printer.alignLeft();
            printer.bold(true);

            if (data.ncf) {
                printer.println(`NCF: ${data.ncf}`);
            }
            printer.println(`FACTURA: ${data.invoiceNumber || 'N/A'}`);
            printer.bold(false);

            printer.println(`Fecha: ${this.formatDate(data.date)}`);
            printer.println(`Cliente: ${data.customerName || 'Consumidor Final'}`);

            if (data.customerRnc) {
                printer.println(`RNC/Cedula: ${data.customerRnc}`);
            }

            printer.drawLine();

            // Tabla de items
            printer.tableCustom([
                { text: 'Cant', align: 'LEFT', width: 0.1 },
                { text: 'Descripcion', align: 'LEFT', width: 0.5 },
                { text: 'Total', align: 'RIGHT', width: 0.39 }
            ]);
            printer.drawLine();

            // Items
            for (const item of data.items || []) {
                const qty = item.quantity || 1;
                const unitPrice = item.price || 0;
                const itemTotal = item.total || (qty * unitPrice);

                printer.tableCustom([
                    { text: qty.toString(), align: 'LEFT', width: 0.1 },
                    { text: this.truncate(item.name || item.description || '', 24), align: 'LEFT', width: 0.5 },
                    { text: `RD$${this.formatMoney(itemTotal)}`, align: 'RIGHT', width: 0.39 }
                ]);

                // Precio unitario si es diferente
                if (qty > 1 && unitPrice) {
                    printer.println(`  @ RD$${this.formatMoney(unitPrice)} c/u`);
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
                printer.println(`ITBIS (18%): RD$${this.formatMoney(data.tax)}`);
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
