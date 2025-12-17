// Initial Data
const initialItem = {
    name: '',
    price: 0,
    qty: 1
};

// State
let currentInvoiceItems = [];

// Safe Storage Helper
const safeStorage = {
    getItem: (key) => {
        try { return localStorage.getItem(key); } catch (e) { console.warn('Storage Access Denied', e); return null; }
    },
    setItem: (key, val) => {
        try { localStorage.setItem(key, val); return true; } catch (e) {
            console.warn('Storage Access Denied', e);
            alert('Warning: Cannot save data (Browser blocked Storage). Try opening this file with a local server (vsCode Live Server).');
            return false;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    try {
        // 1. Initialize Default Values
        initializeDefaults();

        // 2. Setup Event Listeners
        setupEventListeners();

        // 3. Render Initial State
        renderItems();
        updatePreview();

        // 4. Load History (if any) to check ID
        autoGenerateNextId();

        console.log("Invoice App Initialized Successfully");
    } catch (criticalError) {
        alert("App Initialization Error: " + criticalError.message);
        console.error(criticalError);
    }
});

function initializeDefaults() {
    const dateInput = document.getElementById('invoiceDate');
    if (!dateInput.value) {
        dateInput.valueAsDate = new Date();
    }

    // Add default item if list is empty
    if (currentInvoiceItems.length === 0) {
        currentInvoiceItems.push({ ...initialItem });
    }

    // Initialize Payment Settings
    const storedUpi = safeStorage.getItem('brandlift_upi_id');
    if (storedUpi) {
        document.getElementById('upiId').value = storedUpi;
    }

    // Safely try to render initial QR
    try {
        updateQRCode(1500);
    } catch (e) {
        console.warn('QR Code lib not loaded yet');
    }

    // 2. Setup Event Listeners
    setupEventListeners();
    // Input Bindings
    bindPreviewUpdater('invoiceId', 'previewInvoiceId');
    bindPreviewUpdater('invoiceDate', 'previewDate', (val) => {
        if (!val) return '';
        const d = new Date(val);
        return d.toLocaleDateString('en-GB');
    });
    bindPreviewUpdater('clientName', 'previewClientName');

    // Buttons
    document.getElementById('addItemBtn').addEventListener('click', () => {
        currentInvoiceItems.push({ name: '', price: 0, qty: 1 });
        renderItems();
        updatePreview();
    });

    document.getElementById('downloadBtn').addEventListener('click', generatePDF);
    document.getElementById('saveBtn').addEventListener('click', saveInvoice);
    document.getElementById('newInvoiceBtn').addEventListener('click', startNewInvoice);
    document.getElementById('toggleHistoryBtn').addEventListener('click', toggleHistory);
    document.getElementById('closeHistoryBtn').addEventListener('click', toggleHistory);

    // Payment Listeners
    document.getElementById('upiId').addEventListener('input', (e) => {
        safeStorage.setItem('brandlift_upi_id', e.target.value);
        updatePreview(); // Re-render QR
    });

    document.getElementById('qrUpload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = `<img src="${e.target.result}" style="width:100px; height:100px; object-fit:contain;">`;
                document.getElementById('qrcode').innerHTML = img;
                // Store this customization in state? For simple usage, we just render it.
                // We'll mark a flag that we are using custom QR so updatePreview doesn't overwrite it immediately
                document.getElementById('qrcode').dataset.custom = "true";
            };
            reader.readAsDataURL(file);
        } else {
            document.getElementById('qrcode').dataset.custom = "false";
            updatePreview();
        }
    });
}

function bindPreviewUpdater(inputId, previewId, formatter = null) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);

    if (input && preview) {
        input.addEventListener('input', () => {
            preview.innerText = formatter ? formatter(input.value) : input.value;
        });
        // Initial sync
        preview.innerText = formatter ? formatter(input.value) : input.value;
    }
}

// --- Item Management ---

function renderItems() {
    const container = document.getElementById('lineItemsContainer');
    container.innerHTML = '';

    currentInvoiceItems.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'line-item-row';

        row.innerHTML = `
            <input type="text" class="item-name" value="${item.name}" placeholder="Item Name" data-idx="${index}">
            <input type="number" class="item-price" value="${item.price}" placeholder="Price" data-idx="${index}">
            <input type="number" class="item-qty" value="${item.qty}" placeholder="Qty" data-idx="${index}">
            <button type="button" class="remove-btn" data-idx="${index}">×</button>
        `;

        container.appendChild(row);
    });

    // Bind events to new inputs
    container.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', (e) => {
            const idx = e.target.dataset.idx;
            const field = e.target.classList.contains('item-name') ? 'name' :
                e.target.classList.contains('item-price') ? 'price' : 'qty';

            currentInvoiceItems[idx][field] = field === 'name' ? e.target.value : parseFloat(e.target.value) || 0;
            updatePreview();
        });
    });

    container.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            currentInvoiceItems.splice(idx, 1);
            renderItems();
            updatePreview();
        });
    });
}

function updatePreview() {
    const tbody = document.getElementById('previewItemsBody');
    const totalEl = document.getElementById('previewTotal');

    tbody.innerHTML = '';
    let grandTotal = 0;

    currentInvoiceItems.forEach(item => {
        const total = item.price * item.qty;
        grandTotal += total;

        if (item.name || item.price > 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="text-left">${item.name}</td>
                <td class="text-center">${item.price} Rs</td>
                <td class="text-center">${item.qty}</td>
                <td class="text-right">${total} RS</td>
            `;
            tbody.appendChild(tr);
        }
    });

    totalEl.innerText = `${grandTotal} Rs`;
    updateQRCode(grandTotal);
}

function updateQRCode(amount) {
    const qrContainer = document.getElementById('qrcode');

    // If user uploaded a custom image and didn't clear it, don't overwrite with auto-generated code
    // UNLESS the amount changed? Actually, if it's a static image (like GPay screenshot), it doesn't encode amount.
    // So we respect the custom image if present.
    if (qrContainer.dataset.custom === "true") return;

    qrContainer.innerHTML = ''; // Clear previous
    const upiId = document.getElementById('upiId').value || 'brandlift@upi';

    if (typeof QRCode === 'undefined') {
        qrContainer.innerHTML = '<p style="font-size:0.7rem; color:#666; text-align:center; padding:10px; border:1px dashed #ccc;">QR Lib Missing</p>';
        return;
    }

    new QRCode(qrContainer, {
        text: `upi://pay?pa=${upiId}&pn=Brandlift&am=${amount}`,
        width: 100,
        height: 100
    });
}

// --- History & Storage Logic ---

function getInvoices() {
    const stored = safeStorage.getItem('brandlift_invoices');
    return stored ? JSON.parse(stored) : [];
}

function saveInvoice() {
    const id = document.getElementById('invoiceId').value;
    if (!id) return alert('Please enter an Invoice ID');

    const invoiceData = {
        id: id,
        date: document.getElementById('invoiceDate').value,
        clientName: document.getElementById('clientName').value,
        clientAddress: document.getElementById('clientAddress').value,
        items: currentInvoiceItems,
        savedAt: new Date().toISOString()
    };

    const invoices = getInvoices();
    // Check if exists, update index if so
    const existingIndex = invoices.findIndex(inv => inv.id === id);

    if (existingIndex >= 0) {
        if (!confirm('Invoice ID exists. Overwrite?')) return;
        invoices[existingIndex] = invoiceData;
    } else {
        invoices.push(invoiceData);
    }

    if (safeStorage.setItem('brandlift_invoices', JSON.stringify(invoices))) {
        alert('Invoice Saved!');
        renderHistoryList();
    }
}

function autoGenerateNextId() {
    const invoices = getInvoices();
    if (invoices.length === 0) {
        // Default start
        document.getElementById('invoiceId').value = "BL-25-12-01";
        // Update preview
        document.getElementById('previewInvoiceId').innerText = "BL-25-12-01";
        return;
    }

    // Sort by savedAt descending to get latest, or just parse IDs
    // Let's try to find the "max" ID based on the suffix number
    // Assumption: Format is PREFIX-YY-MM-XX

    let maxNum = 0;
    invoices.forEach(inv => {
        const parts = inv.id.split('-');
        if (parts.length > 0) {
            const num = parseInt(parts[parts.length - 1]);
            if (!isNaN(num) && num > maxNum) maxNum = num;
        }
    });

    const nextNum = maxNum + 1;
    const paddedNum = nextNum.toString().padStart(2, '0');

    // Construct new ID using current date parts or keep prefix?
    // Let's stick to the user's requested format "BL-25-12-xx"
    // Ideally we should use current Month/Year
    const today = new Date();
    const yy = today.getFullYear().toString().slice(-2);
    const mm = (today.getMonth() + 1).toString().padStart(2, '0');

    const newId = `BL-${yy}-${mm}-${paddedNum}`;
    document.getElementById('invoiceId').value = newId;

    // Manually trigger preview update since setting value programmatically doesn't trigger 'input'
    document.getElementById('previewInvoiceId').innerText = newId;
}

function startNewInvoice() {
    // Reset fields
    document.getElementById('clientName').value = '';
    document.getElementById('clientAddress').value = '';
    document.getElementById('invoiceDate').valueAsDate = new Date();

    currentInvoiceItems = [{ name: '', price: 0, qty: 1 }];
    renderItems();
    updatePreview();

    // Generate new ID
    autoGenerateNextId();

    // Reset QR State
    resetQRState();
}

function resetQRState() {
    document.getElementById('qrcode').dataset.custom = "false";
    document.getElementById('qrUpload').value = ""; // Clear file input
    // Force re-render of standard QR
    // The updatePreview() call in startNewInvoice/loadInvoice does this, 
    // BUT only if we do this reset BEFORE updatePreview in those functions 
    // OR we explicitly call updateQRCode here.
    // updateQRCode relies on total, loops... easier to just let updatePreview handle it 
    // IF we call resetQRState() BEFORE updatePreview().
}

// --- History UI ---

function toggleHistory() {
    const sidebar = document.getElementById('historySidebar');
    sidebar.classList.toggle('open');
    if (sidebar.classList.contains('open')) {
        renderHistoryList();
    }
}

function renderHistoryList() {
    const list = document.getElementById('historyList');
    const invoices = getInvoices();

    // Sort Newest First
    invoices.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

    list.innerHTML = '';
    if (invoices.length === 0) {
        list.innerHTML = '<p style="color:#666; text-align:center;">No history found</p>';
        return;
    }

    invoices.forEach(inv => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const total = inv.items.reduce((sum, i) => sum + (i.price * i.qty), 0);

        item.innerHTML = `
            <h4>${inv.id}</h4>
            <p>${inv.clientName || 'Unknown Client'}</p>
            <span class="date">${new Date(inv.date).toLocaleDateString()} • ₹${total}</span>
        `;

        item.addEventListener('click', () => loadInvoice(inv));
        list.appendChild(item);
    });
}

function loadInvoice(inv) {
    document.getElementById('invoiceId').value = inv.id;
    document.getElementById('invoiceDate').value = inv.date;
    document.getElementById('clientName').value = inv.clientName;
    document.getElementById('clientAddress').value = inv.clientAddress;

    currentInvoiceItems = JSON.parse(JSON.stringify(inv.items)); // Deep copy

    // Reset QR to standard before rendering
    document.getElementById('qrcode').dataset.custom = "false";
    document.getElementById('qrUpload').value = "";

    renderItems();
    updatePreview();

    // Trigger input events to update preview text for static fields
    document.getElementById('previewInvoiceId').innerText = inv.id;
    document.getElementById('previewClientName').innerText = inv.clientName || '';
    const d = new Date(inv.date);
    document.getElementById('previewDate').innerText = d.toLocaleDateString('en-GB');

    toggleHistory(); // Close sidebar
}

// --- PDF Generation ---
function generatePDF() {
    const element = document.getElementById('invoice');
    const button = document.getElementById('downloadBtn');
    const originalText = button.innerHTML;

    button.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Generating...";
    button.disabled = true;

    if (typeof html2pdf === 'undefined') {
        alert('Error: PDF Generator library not loaded. Please check your internet connection.');
        button.innerHTML = originalText;
        button.disabled = false;
        return;
    }

    const opt = {
        margin: 0,
        filename: `Invoice_${document.getElementById('invoiceId').value}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        button.innerHTML = originalText;
        button.disabled = false;

        // Auto-save on download? Optional, maybe nice.
        // saveInvoice(); 
    });
}
