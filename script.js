        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";
        import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-analytics.js";
        import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-auth.js";
        import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc as fsDeleteDoc } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-firestore.js";

        const firebaseConfig = {
            apiKey: "AIzaSyA91xQGPS55qp8ckpnDaVa2d9vA4ztg9Hk",
            authDomain: "sorteioavilar.firebaseapp.com",
            projectId: "sorteioavilar",
            storageBucket: "sorteioavilar.firebasestorage.app",
            messagingSenderId: "716396310401",
            appId: "1:716396310401:web:e17ce4f61e425d1c458280",
            measurementId: "G-CNMH0N1C5L"
        };

        const app = initializeApp(firebaseConfig);
        const analytics = getAnalytics(app);
        const auth = getAuth(app);
        const db = getFirestore(app);

        // ── App State ──
        let transactions = [];
        let categories = [];
        let categoryMeta = {};
        let currentMonth = new Date().toISOString().slice(0, 7);
        let editingId = null;
        let expenseChartInstance = null;
        let currentUser = null;
        let householdCode = null;
        let chartFilter = 'all';
        let meuNome = ''; // Nome personalizado do usuário atual
        let isAnonymous = false; // Modo anônimo
        let currentDebtRolloverId = null;
        let householdMemberCount = 1;

        const DEFAULT_CATEGORIES = ['Alimentação','Moradia','Transporte','Lazer','Saúde','Educação','Salário','Investimentos','Outros'];
        const CATEGORY_COLOR_PALETTE = [
            '#059669', '#7c3aed', '#f59e0b', '#e11d48',
            '#3b82f6', '#ec4899', '#14b8a6', '#f97316',
            '#6366f1', '#ef4444', '#06b6d4', '#84cc16',
            '#a855f7', '#22d3ee', '#e879f9', '#fb923c',
            '#4ade80', '#fbbf24', '#60a5fa', '#c084fc'
        ];

        const formatCurrency = (v) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v);
        const formatDate = (d) => {
            const [y, m, day] = d.split('-');
            return `${day}/${m}/${y}`;
        };
        const dateToString = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const addMonthsToDate = (dateStr, months) => {
            const d = new Date(dateStr + 'T12:00:00');
            d.setMonth(d.getMonth() + months);
            return dateToString(d);
        };
        const stripInstallmentSuffix = (text = '') => String(text).replace(/\s*\(\d+\/\d+\)\s*$/, '');
        const baseDescriptionOf = (t) => stripInstallmentSuffix(t.description || t.category || 'Dívida');

        function getDefaultCategoryColor(category = '') {
            let hash = 0;
            const key = String(category || 'Outros');
            for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash) + key.charCodeAt(i);
            return CATEGORY_COLOR_PALETTE[Math.abs(hash) % CATEGORY_COLOR_PALETTE.length];
        }

        function isValidHexColor(value) {
            return /^#[0-9a-f]{6}$/i.test(String(value || ''));
        }

        function getCategoryMeta(category = '') {
            const key = String(category || 'Outros');
            return categoryMeta[key] || {};
        }

        function getCategoryColor(category = '') {
            const color = getCategoryMeta(category).color;
            return isValidHexColor(color) ? color : getDefaultCategoryColor(category);
        }

        function getCategoryLogo(category = '') {
            const logo = getCategoryMeta(category).logo;
            return typeof logo === 'string' && logo.startsWith('data:image/') ? logo : '';
        }

        function escapeHtml(value = '') {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function categoryAvatarHtml(category = '', extraClass = '') {
            const color = getCategoryColor(category);
            const logo = getCategoryLogo(category);
            const initial = escapeHtml(String(category || 'O').trim().charAt(0).toUpperCase() || 'O');
            const cls = extraClass ? ` ${extraClass}` : '';
            if (logo) return `<img src="${logo}" alt="" class="cat-logo-thumb${cls}">`;
            return `<span class="cat-logo-fallback${cls}" style="background:${color};">${initial}</span>`;
        }

        function categoryLabelHtml(category = '', extraClass = '') {
            const color = getCategoryColor(category);
            return `<span class="inline-flex items-center gap-2 ${extraClass}" style="color:${color};">${categoryAvatarHtml(category)}<span>${escapeHtml(category)}</span></span>`;
        }

        function categoryPillHtml(category = '') {
            return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-zinc-900/5 text-zinc-600 border border-zinc-900/8">${categoryAvatarHtml(category, 'cat-pill-logo')}<span>${escapeHtml(category)}</span></span>`;
        }

        function hexToRgba(hex, alpha = 1) {
            const h = String(hex).replace('#', '');
            const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
            const r = (bigint >> 16) & 255;
            const g = (bigint >> 8) & 255;
            const b = bigint & 255;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        function getTransactionAccentColor(t) {
            if (t.paymentStatus === 'paid') return '#059669';
            if (t.paymentStatus === 'unpaid') return '#e11d48';
            return getCategoryColor(t.category);
        }

        function generateHouseholdCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
            return code;
        }

        // ── Toast Notifications ──
        function showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.animation = 'slideIn 0.3s ease-out reverse';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // ── Expose functions ──
        window.handleLogin = handleLogin;
        window.handleRegister = handleRegister;
        window.toggleRegister = toggleRegister;
        window.handleLogout = handleLogout;
        window.openModal = openModal;
        window.closeModal = closeModal;
        window.editTransaction = editTransaction;
        window.deleteTransaction = deleteTransaction;
        window.openCategoryModal = openCategoryModal;
        window.closeCategoryModal = closeCategoryModal;
        window.addCategory = addCategory;
        window.deleteCategory = deleteCategory;
        window.updateCategoryColor = updateCategoryColor;
        window.handleCategoryLogoUpload = handleCategoryLogoUpload;
        window.removeCategoryLogo = removeCategoryLogo;
        window.autoColorFromLogo = autoColorFromLogo;
        window.handleTransactionSubmit = handleTransactionSubmit;
        window.setChartFilter = setChartFilter;
        window.onChartViewModeChange = onChartViewModeChange;
        window.onChartTypeModeChange = onChartTypeModeChange;
        window.clearAllData = clearAllData;
        window.copyHouseholdCode = copyHouseholdCode;
        window.createNewHousehold = createNewHousehold;
        window.showJoinHouseholdForm = showJoinHouseholdForm;
        window.hideJoinHouseholdForm = hideJoinHouseholdForm;
        window.joinExistingHousehold = joinExistingHousehold;
        window.resetHistoryFilters = resetHistoryFilters;
        window.updateUI = updateUI;
        window.openProfileModal = openProfileModal;
        window.closeProfileModal = closeProfileModal;
        window.handleProfileSubmit = handleProfileSubmit;
        window.markDebtStatus = markDebtStatus;
        window.closeDebtRolloverModal = closeDebtRolloverModal;
        window.confirmDebtRollover = confirmDebtRollover;

        // ── Auth State Observer ──
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUser = user;
                document.getElementById('loginScreen').classList.add('hidden');

                // Load custom name from Firestore
                meuNome = await loadUserDisplayName();
                const displayName = getMyDisplayName();
                document.getElementById('userNameDisplay').textContent = displayName;

                const hasHousehold = await checkUserHousehold();
                
                if (hasHousehold) {
                    document.getElementById('setupHouseholdScreen').classList.add('hidden');
                    document.getElementById('appContent').classList.remove('hidden');
                    await loadHouseholdData();
                    initApp();
                } else {
                    document.getElementById('appContent').classList.add('hidden');
                    document.getElementById('setupHouseholdScreen').classList.remove('hidden');
                }
            } else {
                currentUser = null;
                householdCode = null;
                meuNome = '';
                document.getElementById('loginScreen').classList.remove('hidden');
                document.getElementById('setupHouseholdScreen').classList.add('hidden');
                document.getElementById('appContent').classList.add('hidden');
            }
        });

        async function checkUserHousehold() {
            if (!currentUser) return false;
            try {
                const userRef = doc(db, 'users', currentUser.uid);
                const userSnap = await getDoc(userRef);
                if (userSnap.exists() && userSnap.data().householdCode) {
                    householdCode = userSnap.data().householdCode;
                    return true;
                }
                return false;
            } catch (error) {
                console.error('Error checking household:', error);
                return false;
            }
        }

        async function createNewHousehold() {
            if (!currentUser) return;
            
            const btn = document.getElementById('createHouseBtn');
            const btnText = document.getElementById('createHouseBtnText');
            const spinner = document.getElementById('createHouseSpinner');
            
            btn.disabled = true;
            btnText.textContent = 'Criando...';
            spinner.classList.remove('hidden');
            
            try {
                const code = generateHouseholdCode();
                
                await withTimeout(setDoc(doc(db, 'households', code), {
                    createdAt: new Date().toISOString(),
                    createdBy: currentUser.uid,
                    members: [currentUser.uid]
                }));
                
                await withTimeout(setDoc(doc(db, 'households', code, 'settings', 'main'), {
                    categories: DEFAULT_CATEGORIES,
                    categoryMeta: {}
                }));
                
                await withTimeout(setDoc(doc(db, 'users', currentUser.uid), {
                    name: currentUser.displayName || currentUser.email,
                    email: currentUser.email,
                    householdCode: code,
                    createdAt: new Date().toISOString()
                }, { merge: true }));
                
                householdCode = code;
                
                document.getElementById('setupHouseholdScreen').classList.add('hidden');
                document.getElementById('appContent').classList.remove('hidden');
                
                await loadHouseholdData();
                initApp();
                
                showToast('Casa criada com sucesso! Código: ' + code);
                
            } catch (error) {
                console.error('Error creating household:', error);
                document.getElementById('setupError').textContent = `Erro ao criar casa: ${error.message}`;
                document.getElementById('setupError').classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btnText.textContent = 'Criar Nova Casa';
                spinner.classList.add('hidden');
            }
        }

        function showJoinHouseholdForm() {
            document.getElementById('setupOptions').classList.add('hidden');
            document.getElementById('joinHouseForm').classList.remove('hidden');
        }

        function hideJoinHouseholdForm() {
            document.getElementById('setupOptions').classList.remove('hidden');
            document.getElementById('joinHouseForm').classList.add('hidden');
            document.getElementById('setupError').classList.add('hidden');
        }

        async function joinExistingHousehold(e) {
            e.preventDefault();
            if (!currentUser) return;
            
            const code = document.getElementById('joinHouseCode').value.trim().toUpperCase();
            
            const btn = document.getElementById('joinHouseBtn');
            const btnText = document.getElementById('joinHouseBtnText');
            const spinner = document.getElementById('joinHouseSpinner');
            
            btn.disabled = true;
            btnText.textContent = 'Entrando...';
            spinner.classList.remove('hidden');
            document.getElementById('setupError').classList.add('hidden');
            
            try {
                const householdRef = doc(db, 'households', code);
                const hhSnap = await getDoc(householdRef);
                
                if (!hhSnap.exists()) {
                    throw new Error('Código da casa não encontrado.');
                }
                
                const hhData = hhSnap.data();
                const members = hhData.members || [];
                if (!members.includes(currentUser.uid)) {
                    members.push(currentUser.uid);
                    await setDoc(householdRef, { ...hhData, members }, { merge: true });
                }
                
                await setDoc(doc(db, 'users', currentUser.uid), {
                    name: currentUser.displayName || currentUser.email,
                    email: currentUser.email,
                    householdCode: code,
                    createdAt: new Date().toISOString()
                }, { merge: true });
                
                householdCode = code;
                
                document.getElementById('setupHouseholdScreen').classList.add('hidden');
                document.getElementById('appContent').classList.remove('hidden');
                
                await loadHouseholdData();
                initApp();
                
                showToast('Entrou na casa com sucesso!');
                
            } catch (error) {
                console.error('Error joining household:', error);
                document.getElementById('setupError').textContent = error.message;
                document.getElementById('setupError').classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btnText.textContent = 'Entrar na Casa';
                spinner.classList.add('hidden');
            }
        }

        async function handleLogin(e) {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;
            showLoginLoading(true);
            hideLoginError();
            try {
                await signInWithEmailAndPassword(auth, email, password);
            } catch (err) {
                showLoginError(getPtBrError(err.code));
            }
            showLoginLoading(false);
        }

        async function handleRegister(e) {
            e.preventDefault();
            const name = document.getElementById('regName').value.trim();
            const email = document.getElementById('regEmail').value.trim();
            const password = document.getElementById('regPassword').value;
            const inputCode = document.getElementById('regHouseholdCode').value.trim().toUpperCase();
            showRegLoading(true);
            hideLoginError();
            try {
                const cred = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(cred.user, { displayName: name });

                let code;
                if (inputCode) {
                    code = inputCode;
                    const householdRef = doc(db, 'households', code);
                    const hhSnap = await getDoc(householdRef);
                    if (!hhSnap.exists()) {
                        await setDoc(householdRef, {
                            createdAt: new Date().toISOString(),
                            createdBy: cred.user.uid,
                            members: [cred.user.uid]
                        });
                        await setDoc(doc(householdRef, 'settings', 'main'), {
                            categories: DEFAULT_CATEGORIES,
                            categoryMeta: {}
                        });
                    } else {
                        const hhData = hhSnap.data();
                        const members = hhData.members || [];
                        if (!members.includes(cred.user.uid)) {
                            members.push(cred.user.uid);
                            await setDoc(householdRef, { ...hhData, members }, { merge: true });
                        }
                    }
                } else {
                    code = generateHouseholdCode();
                    let exists = true;
                    while (exists) {
                        const check = await getDoc(doc(db, 'households', code));
                        if (!check.exists()) exists = false;
                        else code = generateHouseholdCode();
                    }
                    await setDoc(doc(db, 'households', code), {
                        createdAt: new Date().toISOString(),
                        createdBy: cred.user.uid,
                        members: [cred.user.uid]
                    });
                    await setDoc(doc(db, 'households', code, 'settings', 'main'), {
                        categories: DEFAULT_CATEGORIES,
                        categoryMeta: {}
                    });
                }

                await setDoc(doc(db, 'users', cred.user.uid), {
                    name,
                    email,
                    householdCode: code,
                    createdAt: new Date().toISOString()
                }, { merge: true });

                householdCode = code;
                showHouseholdBadge(code);
            } catch (err) {
                showLoginError(getPtBrError(err.code));
            }
            showRegLoading(false);
        }

        async function handleLogout() {
            await signOut(auth);
        }

        function toggleRegister() {
            const form = document.getElementById('registerForm');
            const btn = document.getElementById('toggleRegBtn');
            if (form.classList.contains('hidden')) {
                form.classList.remove('hidden');
                btn.textContent = 'Já tenho conta';
            } else {
                form.classList.add('hidden');
                btn.textContent = 'Criar conta';
            }
        }

        async function loadHouseholdData() {
            if (!currentUser || !householdCode) {
                console.error('Cannot load: currentUser or householdCode is null');
                return;
            }

            try {
                showHouseholdBadge(householdCode);

                const householdRef = doc(db, 'households', householdCode);
                const householdSnap = await withTimeout(getDoc(householdRef));
                const members = householdSnap.exists() ? (householdSnap.data().members || []) : [];
                householdMemberCount = members.length || 1;
                updateHouseCardsVisibility();

                const settingsRef = doc(db, 'households', householdCode, 'settings', 'main');
                const settingsSnap = await withTimeout(getDoc(settingsRef));
                if (settingsSnap.exists()) {
                    const data = settingsSnap.data();
                    categories = Array.isArray(data.categories) ? [...data.categories] : [...DEFAULT_CATEGORIES];
                    categoryMeta = normalizeCategoryMeta(data.categoryMeta || {});
                } else {
                    categories = [...DEFAULT_CATEGORIES];
                    categoryMeta = normalizeCategoryMeta({});
                    await withTimeout(setDoc(settingsRef, { categories, categoryMeta }));
                }

                const txSnap = await withTimeout(getDocs(collection(db, 'households', householdCode, 'transactions')));
                transactions = txSnap.docs.map(d => ({ id: Number(d.id), ...d.data() }));
                
            } catch (error) {
                console.error('Erro ao carregar dados:', error);
                showToast(`Erro ao carregar: ${error.message}`, 'error');
            }
        }

        function showHouseholdBadge(code) {
            document.getElementById('householdCodeDisplay').textContent = code;
            document.getElementById('householdBadge').classList.remove('hidden');
            document.getElementById('householdBadge').style.display = 'flex';
        }

        function updateHouseCardsVisibility() {
            const houseCards = document.querySelectorAll('.house-card');
            const grid = document.getElementById('summaryCardsGrid');
            if (!houseCards.length) return;
            const showHouseCards = householdMemberCount > 1;
            houseCards.forEach(card => card.classList.toggle('hidden', !showHouseCards));
            if (grid) {
                grid.classList.toggle('lg:grid-cols-4', showHouseCards);
                grid.classList.toggle('lg:grid-cols-2', !showHouseCards);
            }
        }

        function copyHouseholdCode() {
            if (!householdCode) return;
            navigator.clipboard.writeText(householdCode).then(() => {
                const el = document.getElementById('householdCodeDisplay');
                const original = el.textContent;
                el.textContent = 'Copiado!';
                setTimeout(() => { el.textContent = original; }, 1500);
            });
        }

        function withTimeout(promise, ms = 10000) {
            return Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite excedido. Verifique sua conexão.')), ms))
            ]);
        }

        function normalizeCategoryMeta(meta = {}) {
            const normalized = {};
            categories.forEach(cat => {
                const item = meta?.[cat] || {};
                normalized[cat] = {
                    color: isValidHexColor(item.color) ? item.color : getDefaultCategoryColor(cat),
                    logo: typeof item.logo === 'string' && item.logo.startsWith('data:image/') ? item.logo : ''
                };
            });
            return normalized;
        }

        async function saveSingleTransaction(t) {
            if (!currentUser || !householdCode) {
                throw new Error('Usuário ou casa não configurados');
            }
            const { id, ...data } = t;
            await withTimeout(setDoc(doc(db, 'households', householdCode, 'transactions', String(id)), data));
        }

        async function deleteTransactionFromFirestore(id) {
            if (!currentUser || !householdCode) return;
            await withTimeout(fsDeleteDoc(doc(db, 'households', householdCode, 'transactions', String(id))));
        }

        async function saveSettingsToFirestore() {
            if (!currentUser || !householdCode) return;
            categoryMeta = normalizeCategoryMeta(categoryMeta);
            await withTimeout(setDoc(doc(db, 'households', householdCode, 'settings', 'main'), { categories, categoryMeta }));
        }

        async function clearAllTransactionsInFirestore() {
            if (!currentUser || !householdCode) return;
            const snap = await withTimeout(getDocs(collection(db, 'households', householdCode, 'transactions')));
            const promises = snap.docs.map(d => withTimeout(fsDeleteDoc(d.ref)));
            await Promise.all(promises);
        }

        function initApp() {
            const monthInput = document.getElementById('monthFilter');
            monthInput.value = currentMonth;
            monthInput.onchange = (e) => { currentMonth = e.target.value; updateUI(); };
            const dateInput = document.querySelector('#transactionForm input[name="date"]');
            if (dateInput) dateInput.valueAsDate = new Date();
            populateCategorySelects();
            onChartViewModeChange();
            setChartFilter('all');
            setupDebtRolloverControls();
            updateUI();
        }

        function isVisibleMonthlyTransaction(t) {
            return t.paymentStatus !== 'unpaid';
        }

        function getFilteredTransactions() {
            return transactions.filter(t => t.date.startsWith(currentMonth) && isVisibleMonthlyTransaction(t));
        }

        function updateUI() { updateSummary(); renderTransactions(); renderChart(); }

        function setupDebtRolloverControls() {
            const form = document.getElementById('debtRolloverForm');
            if (!form || form.dataset.ready === '1') return;
            form.dataset.ready = '1';
            form.querySelectorAll('input[name="rolloverAction"]').forEach(input => {
                input.addEventListener('change', () => {
                    const fields = document.getElementById('reparcelFields');
                    if (fields) fields.style.display = form.rolloverAction.value === 'reparcel' ? 'block' : 'none';
                });
            });
        }

        function updateSummary() {
            let f = getFilteredTransactions();
            const uid = currentUser?.uid;

            // Filter out anonymous transactions from other users for house totals
            f = f.filter(t => {
                if (t.userId === uid) return true; // Own transactions always visible
                if (t.isAnonymous) return false;
                return true;
            });

            // House totals (all members, excluding anonymous from others)
            const houseIncome = f.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            const houseExpense = f.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

            // User totals (only current user)
            const userTransactions = f.filter(t => t.userId === uid);
            const userIncome = userTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            const userExpense = userTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

            document.getElementById('houseIncome').textContent = formatCurrency(houseIncome);
            document.getElementById('houseExpense').textContent = formatCurrency(houseExpense);
            document.getElementById('userIncome').textContent = formatCurrency(userIncome);
            document.getElementById('userExpense').textContent = formatCurrency(userExpense);

            // User balance
            const userBalance = userIncome - userExpense;
            const balanceEl = document.getElementById('userBalance');
            const statusEl = document.getElementById('balanceStatus');
            
            balanceEl.textContent = formatCurrency(userBalance);
            
            if (userBalance > 0) {
                balanceEl.className = 'font-display text-2xl sm:text-3xl font-semibold text-primary break-all';
                statusEl.textContent = 'Sobrando';
                statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20';
            } else if (userBalance < 0) {
                balanceEl.className = 'font-display text-2xl sm:text-3xl font-semibold text-danger break-all';
                statusEl.textContent = 'No negativo';
                statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-danger/10 text-danger border border-danger/20';
            } else {
                balanceEl.className = 'font-display text-2xl sm:text-3xl font-semibold text-zinc-900 break-all';
                statusEl.textContent = 'Equilibrado';
                statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-zinc-900/5 text-zinc-600 border border-zinc-900/10';
            }
        }

        function renderTransactions() {
            const tbody = document.getElementById('transactionsList');
            const mobileList = document.getElementById('transactionsListMobile');
            const emptyState = document.getElementById('emptyState');
            const filterBar = document.getElementById('historyFilterBar');
            tbody.innerHTML = '';
            mobileList.innerHTML = '';
            const tbodyFrag = document.createDocumentFragment();
            const mobileFrag = document.createDocumentFragment();

            const monthFiltered = getFilteredTransactions();

            // Show/hide filter bar when there are transactions
            if (monthFiltered.length > 0) {
                filterBar.style.display = 'flex';
                populateUserFilter(monthFiltered);
            } else {
                filterBar.style.display = 'none';
            }

            // Apply user filter
            const userFilter = document.getElementById('filterUser')?.value || 'all';
            let filtered = monthFiltered;
            if (userFilter !== 'all') filtered = filtered.filter(t => t.userId === userFilter);

            // Apply type filter
            const typeFilter = document.getElementById('filterType')?.value || 'all';
            if (typeFilter !== 'all') filtered = filtered.filter(t => t.type === typeFilter);

            // Filter out anonymous transactions from other users
            filtered = filtered.filter(t => {
                if (t.userId === currentUser?.uid) return true;
                if (t.isAnonymous) return false;
                return true;
            });

            if (filtered.length === 0) { emptyState.classList.remove('hidden'); return; }
            emptyState.classList.add('hidden');

            // Apply sort
            const sortVal = document.getElementById('filterSort')?.value || 'date-desc';
            let sorted;
            if (sortVal === 'amount-desc') sorted = [...filtered].sort((a,b) => b.amount - a.amount);
            else if (sortVal === 'amount-asc') sorted = [...filtered].sort((a,b) => a.amount - b.amount);
            else if (sortVal === 'date-asc') sorted = [...filtered].sort((a,b) => new Date(a.date) - new Date(b.date));
            else sorted = [...filtered].sort((a,b) => new Date(b.date) - new Date(a.date));

            // Group by category
            const catOrder = [];
            const catMap = {};
            sorted.forEach(t => {
                if (!catMap[t.category]) { catMap[t.category] = []; catOrder.push(t.category); }
                catMap[t.category].push(t);
            });

            catOrder.forEach(category => {
                const items = catMap[category];
                const hasGroup = items.length > 1;

                if (hasGroup) {
                    // Desktop: category header row
                    const headerTr = document.createElement('tr');
                    headerTr.className = 'cat-group-header';
                    const categoryColor = getCategoryColor(category);
                    headerTr.style.background = `linear-gradient(90deg, ${hexToRgba(categoryColor, 0.20)}, ${hexToRgba(categoryColor, 0.055)})`;
                    headerTr.style.borderLeftColor = categoryColor;
                    const catTotal = items.reduce((s, t) => s + t.amount, 0);
                    headerTr.innerHTML = `<td colspan="6">
                        <div class="flex items-center justify-between">
                            ${categoryLabelHtml(category)}
                            <span class="text-[11px] text-zinc-500 font-normal">${items.length} transações · ${formatCurrency(catTotal)}</span>
                        </div>
                    </td>`;
                    tbodyFrag.appendChild(headerTr);
                }

                // Mobile: category header card
                if (hasGroup) {
                    const catHeader = document.createElement('div');
                    catHeader.className = 'cat-group-card-header';
                    const categoryColor = getCategoryColor(category);
                    catHeader.style.background = `linear-gradient(90deg, ${hexToRgba(categoryColor, 0.20)}, ${hexToRgba(categoryColor, 0.055)})`;
                    catHeader.style.borderLeftColor = categoryColor;
                    const catTotal = items.reduce((s, t) => s + t.amount, 0);
                    catHeader.innerHTML = `<div class="flex items-center justify-between">
                        ${categoryLabelHtml(category)}
                        <span class="text-[11px] text-zinc-500 font-normal">${items.length} transações · ${formatCurrency(catTotal)}</span>
                    </div>`;
                    mobileFrag.appendChild(catHeader);
                }

                items.forEach(t => {
                    const isIncome = t.type === 'income';
                    const userName = t.userName || 'Desconhecido';
                    const isCurrentUser = t.userId === currentUser?.uid;
                    const userBadgeClass = isCurrentUser ? 'bg-accent/20 text-accent border-accent/30' : 'bg-primary/20 text-primary border-primary/30';
                    const groupInfo = t.groupId && t.totalInstallments > 1
                        ? `<span class="text-[9px] text-zinc-600 ml-1">Parcela ${t.installmentNum||'?'}/${t.totalInstallments||'?'}</span>`
                        : '';
                    const desc = t.description || t.category;
                    const cleanDesc = hasGroup ? desc : desc;
                    const safeDesc = escapeHtml(cleanDesc);
                    const safeUserName = escapeHtml(userName);
                    const accentColor = getTransactionAccentColor(t);
                    const rowBg = `linear-gradient(90deg, ${hexToRgba(accentColor, 0.16)}, ${hexToRgba(accentColor, 0.035)})`;
                    const statusPill = t.paymentStatus === 'paid'
                        ? '<span class="debt-status-pill paid">Pago</span>'
                        : (t.paymentStatus === 'unpaid' ? '<span class="debt-status-pill unpaid">Não pago</span>' : '');
                    const debtButtons = !isIncome ? `
                            <span class="debt-status-actions">
                                <button onclick="markDebtStatus(${t.id}, 'paid')" class="debt-status-btn paid ${t.paymentStatus === 'paid' ? 'active' : ''}" title="Marcar como pago">Pago</button>
                                <button onclick="markDebtStatus(${t.id}, 'unpaid')" class="debt-status-btn unpaid ${t.paymentStatus === 'unpaid' ? 'active' : ''}" title="Marcar como não pago">Não pago</button>
                            </span>` : '';
                    
                    // Desktop table row
                    const tr = document.createElement('tr');
                    tr.className = `group hover:bg-zinc-900/[0.02] transition-colors${hasGroup ? ' cat-sub-row' : ''}`;
                    tr.style.background = rowBg;
                    tr.style.borderLeft = `3px solid ${accentColor}`;
                    tr.innerHTML = `
                        <td class="py-3.5"><div class="font-medium text-zinc-800">${safeDesc}${groupInfo} ${statusPill}</div>${!hasGroup && t.description && t.description !== t.category ? `<div class="mt-1">${categoryLabelHtml(t.category, 'text-xs')}</div>` : ''}</td>
                        ${hasGroup ? `<td class="py-3.5 cat-sub-date">${formatDate(t.date)}</td>` : `<td class="py-3.5">${categoryPillHtml(t.category)}</td>`}
                        <td class="py-3.5"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${userBadgeClass} border">${safeUserName}</span></td>
                        ${hasGroup ? `<td class="py-3.5"></td>` : `<td class="py-3.5 text-zinc-500 hidden md:table-cell">${formatDate(t.date)}</td>`}
                        <td class="py-3.5 text-right font-semibold ${isIncome?'text-primary':'text-danger'}">${isIncome?'+':'-'} ${formatCurrency(t.amount)}</td>
                        <td class="py-3.5 text-center"><div class="flex items-center justify-center gap-2 flex-wrap">
                            ${debtButtons}
                            <button onclick="editTransaction(${t.id})" class="text-zinc-500 hover:text-accent transition-colors opacity-0 group-hover:opacity-100" title="Editar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                            <button onclick="deleteTransaction(${t.id})" class="text-zinc-500 hover:text-danger transition-colors opacity-0 group-hover:opacity-100" title="Excluir"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                        </div></td>`;
                    tbodyFrag.appendChild(tr);
                    
                    // Mobile card
                    const card = document.createElement('div');
                    card.className = `bg-zinc-900/[0.025] border border-zinc-900/8 rounded-xl p-4 hover:border-zinc-900/10 transition-colors${hasGroup ? ' cat-sub-card' : ''}`;
                    card.style.background = rowBg;
                    card.style.borderColor = hexToRgba(accentColor, 0.30);
                    card.style.borderLeft = `3px solid ${accentColor}`;
                    card.innerHTML = `
                        <div class="flex items-start justify-between mb-3">
                            <div class="flex-1 min-w-0">
                                <p class="font-medium text-zinc-800 text-sm truncate">${safeDesc}${groupInfo} ${statusPill}</p>
                                ${!hasGroup && t.description && t.description !== t.category ? `<div class="mt-1">${categoryLabelHtml(t.category, 'text-xs')}</div>` : ''}
                            </div>
                            <span class="font-semibold text-sm ${isIncome?'text-primary':'text-danger'} ml-3 whitespace-nowrap">${isIncome?'+':'-'} ${formatCurrency(t.amount)}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2 flex-wrap">
                                ${!hasGroup ? categoryPillHtml(t.category) : ''}
                                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${userBadgeClass} border">${safeUserName}</span>
                                <span class="text-[10px] text-zinc-500">${formatDate(t.date)}</span>
                            </div>
                            <div class="flex items-center gap-2 flex-wrap justify-end">
                                ${debtButtons}
                                <button onclick="editTransaction(${t.id})" class="text-zinc-500 hover:text-accent transition-colors p-1" title="Editar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                                <button onclick="deleteTransaction(${t.id})" class="text-zinc-500 hover:text-danger transition-colors p-1" title="Excluir"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                            </div>
                        </div>`;
                    mobileFrag.appendChild(card);
                });
            });

            tbody.appendChild(tbodyFrag);
            mobileList.appendChild(mobileFrag);
        }

        function populateUserFilter(transactionsList) {
            const select = document.getElementById('filterUser');
            if (!select) return;
            const currentVal = select.value;
            const users = new Map();
            transactionsList.forEach(t => {
                if (t.userId && !users.has(t.userId)) users.set(t.userId, t.userName || 'Desconhecido');
            });
            select.innerHTML = '<option value="all">Todos os usuários</option>';
            users.forEach((name, uid) => {
                const o = document.createElement('option');
                o.value = uid;
                o.textContent = name;
                if (uid === currentVal) o.selected = true;
                select.appendChild(o);
            });
        }

        function resetHistoryFilters() {
            const sortEl = document.getElementById('filterSort');
            const userEl = document.getElementById('filterUser');
            const typeEl = document.getElementById('filterType');
            if (sortEl) sortEl.value = 'date-desc';
            if (userEl) userEl.value = 'all';
            if (typeEl) typeEl.value = 'all';
            updateUI();
        }

        function setChartFilter(filter) {
            chartFilter = filter;
            document.getElementById('chartFilterAll').classList.toggle('active', filter === 'all');
            document.getElementById('chartFilterUser').classList.toggle('active', filter === 'user');
            renderChart();
        }

        function onChartViewModeChange() {
            const viewMode = document.getElementById('chartViewMode').value;
            const customSelectors = document.getElementById('customDateSelectors');
            
            // Show/hide custom date selectors
            if (viewMode === 'custom') {
                customSelectors.style.display = 'flex';
                populateCustomYearSelector();
            } else {
                customSelectors.style.display = 'none';
            }
            
            renderChart();
        }

        function onChartTypeModeChange() {
            const chartTypeMode = document.getElementById('chartTypeMode').value;
            const viewModeWrapper = document.getElementById('chartViewModeWrapper');
            const customSelectors = document.getElementById('customDateSelectors');
            
            if (chartTypeMode === 'categories') {
                // In categories mode, still show viewMode so user can pick period
                viewModeWrapper.style.display = '';
                customSelectors.style.display = 'none';
                const viewMode = document.getElementById('chartViewMode').value;
                if (viewMode === 'custom') customSelectors.style.display = 'flex';
            } else {
                viewModeWrapper.style.display = '';
                const viewMode = document.getElementById('chartViewMode').value;
                customSelectors.style.display = (viewMode === 'custom') ? 'flex' : 'none';
            }
            
            renderChart();
        }

        // Deterministic colors for categories chart/history
        function generateCategoryColors(count) {
            const colors = [];
            for (let i = 0; i < count; i++) {
                colors.push(CATEGORY_COLOR_PALETTE[i % CATEGORY_COLOR_PALETTE.length]);
            }
            return colors;
        }

        // Get filtered transactions based on current view mode and chart filter
        function getChartTransactions() {
            const viewMode = document.getElementById('chartViewMode').value;
            let filtered;
            
            if (viewMode === 'month') {
                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth();
                filtered = transactions.filter(t => {
                    const txDate = new Date(t.date);
                    return txDate.getFullYear() === year && txDate.getMonth() === month;
                });
            } else if (viewMode === 'year') {
                const year = new Date().getFullYear();
                filtered = transactions.filter(t => {
                    const txDate = new Date(t.date);
                    return txDate.getFullYear() === year;
                });
            } else { // custom
                const year = parseInt(document.getElementById('chartCustomYear').value);
                const month = parseInt(document.getElementById('chartCustomMonth').value);
                filtered = transactions.filter(t => {
                    const txDate = new Date(t.date);
                    return txDate.getFullYear() === year && txDate.getMonth() === month;
                });
            }
            
            // Apply user filter
            if (chartFilter === 'user' && currentUser) {
                filtered = filtered.filter(t => t.userId === currentUser.uid);
            }
            // Apply anonymous filter
            filtered = filtered.filter(t => {
                if (t.userId === currentUser?.uid) return true;
                if (t.isAnonymous) return false;
                return true;
            });

            // Unpaid debts are carried out of the active month and should not
            // continue counting in charts or monthly totals.
            filtered = filtered.filter(isVisibleMonthlyTransaction);
            
            return filtered;
        }

        function renderCategoriesChart(ctx) {
            const viewMode = document.getElementById('chartViewMode').value;
            const filtered = getChartTransactions();
            
            if (filtered.length === 0) {
                return;
            }
            
            // Build labels and grouping based on view mode
            let labels = [];
            let groupingFn; // returns the bucket key for a transaction
            
            if (viewMode === 'month') {
                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
                groupingFn = (t) => new Date(t.date).getDate() - 1;
            } else if (viewMode === 'year') {
                labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                groupingFn = (t) => new Date(t.date).getMonth();
            } else { // custom
                const year = parseInt(document.getElementById('chartCustomYear').value);
                const month = parseInt(document.getElementById('chartCustomMonth').value);
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
                groupingFn = (t) => new Date(t.date).getDate() - 1;
            }
            
            // Group transactions by category and by bucket
            const categoryBuckets = {}; // { category: array of values indexed by bucket }
            filtered.forEach(t => {
                if (!categoryBuckets[t.category]) {
                    categoryBuckets[t.category] = Array.from({ length: labels.length }, () => 0);
                }
                const bucket = groupingFn(t);
                if (bucket >= 0 && bucket < labels.length) {
                    categoryBuckets[t.category][bucket] += t.amount;
                }
            });
            
            // Sort categories by total amount descending
            const sortedEntries = Object.entries(categoryBuckets).sort((a, b) => {
                const totalA = a[1].reduce((s, v) => s + v, 0);
                const totalB = b[1].reduce((s, v) => s + v, 0);
                return totalB - totalA;
            });
            
            const colors = sortedEntries.map(([category]) => getCategoryColor(category));
            
            const datasets = sortedEntries.map(([category, values], i) => ({
                label: category,
                data: values,
                borderColor: colors[i],
                backgroundColor: colors[i] + '1a',
                borderWidth: 2,
                tension: 0.3,
                fill: false,
                pointBackgroundColor: colors[i],
                pointBorderColor: colors[i],
                pointRadius: 3,
                pointHoverRadius: 5
            }));
            
            expenseChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                color: '#52525b',
                                font: { family: 'Plus Jakarta Sans', size: 11 },
                                padding: 16,
                                usePointStyle: true,
                                pointStyleWidth: 8
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(24, 24, 27, 0.95)',
                            titleColor: '#fafafa',
                            bodyColor: '#a1a1aa',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 12,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y || 0;
                                    return `${label}: ${formatCurrency(value)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(0, 0, 0, 0.06)', drawBorder: false },
                            ticks: { color: '#71717a', font: { family: 'Plus Jakarta Sans', size: 11 } }
                        },
                        y: {
                            grid: { color: 'rgba(0, 0, 0, 0.06)', drawBorder: false },
                            ticks: {
                                color: '#71717a',
                                font: { family: 'Plus Jakarta Sans', size: 11 },
                                callback: function(value) { return formatCurrency(value); }
                            },
                            beginAtZero: true
                        }
                    }
                }
            });
        }

        function renderEvolutionChart(ctx) {
            const viewMode = document.getElementById('chartViewMode').value;
            
            let labels = [];
            let incomeData = [];
            let expenseData = [];
            
            if (viewMode === 'month') {
                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                
                let monthTransactions = getChartTransactions();
                
                const dailyData = Array.from({ length: daysInMonth }, () => ({ income: 0, expense: 0 }));
                monthTransactions.forEach(t => {
                    const day = new Date(t.date).getDate() - 1;
                    if (t.type === 'income') {
                        dailyData[day].income += t.amount;
                    } else if (t.type === 'expense') {
                        dailyData[day].expense += t.amount;
                    }
                });
                
                labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
                incomeData = dailyData.map(d => d.income);
                expenseData = dailyData.map(d => d.expense);
                
            } else if (viewMode === 'year') {
                let yearTransactions = getChartTransactions();
                
                const monthlyData = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
                yearTransactions.forEach(t => {
                    const month = new Date(t.date).getMonth();
                    if (t.type === 'income') {
                        monthlyData[month].income += t.amount;
                    } else if (t.type === 'expense') {
                        monthlyData[month].expense += t.amount;
                    }
                });
                
                labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                incomeData = monthlyData.map(d => d.income);
                expenseData = monthlyData.map(d => d.expense);
                
            } else if (viewMode === 'custom') {
                const year = parseInt(document.getElementById('chartCustomYear').value);
                const month = parseInt(document.getElementById('chartCustomMonth').value);
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                
                let monthTransactions = getChartTransactions();
                
                const dailyData = Array.from({ length: daysInMonth }, () => ({ income: 0, expense: 0 }));
                monthTransactions.forEach(t => {
                    const day = new Date(t.date).getDate() - 1;
                    if (t.type === 'income') {
                        dailyData[day].income += t.amount;
                    } else if (t.type === 'expense') {
                        dailyData[day].expense += t.amount;
                    }
                });
                
                labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
                incomeData = dailyData.map(d => d.income);
                expenseData = dailyData.map(d => d.expense);
            }
            
            const hasData = incomeData.some(v => v > 0) || expenseData.some(v => v > 0);
            if (!hasData) return;
            
            expenseChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Receitas',
                            data: incomeData,
                            borderColor: '#059669',
                            backgroundColor: 'rgba(5, 150, 105, 0.1)',
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true,
                            pointBackgroundColor: '#059669',
                            pointBorderColor: '#059669',
                            pointRadius: 4,
                            pointHoverRadius: 6
                        },
                        {
                            label: 'Despesas',
                            data: expenseData,
                            borderColor: '#e11d48',
                            backgroundColor: 'rgba(225, 29, 72, 0.1)',
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true,
                            pointBackgroundColor: '#e11d48',
                            pointBorderColor: '#e11d48',
                            pointRadius: 4,
                            pointHoverRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                color: '#52525b',
                                font: {
                                    family: 'Plus Jakarta Sans',
                                    size: 11
                                },
                                padding: 16,
                                usePointStyle: true,
                                pointStyleWidth: 8
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(24, 24, 27, 0.95)',
                            titleColor: '#fafafa',
                            bodyColor: '#a1a1aa',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 12,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y || 0;
                                    return `${label}: ${formatCurrency(value)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: {
                                color: 'rgba(0, 0, 0, 0.06)',
                                drawBorder: false
                            },
                            ticks: {
                                color: '#71717a',
                                font: {
                                    family: 'Plus Jakarta Sans',
                                    size: 11
                                }
                            }
                        },
                        y: {
                            grid: {
                                color: 'rgba(0, 0, 0, 0.06)',
                                drawBorder: false
                            },
                            ticks: {
                                color: '#71717a',
                                font: {
                                    family: 'Plus Jakarta Sans',
                                    size: 11
                                },
                                callback: function(value) {
                                    return formatCurrency(value);
                                }
                            },
                            beginAtZero: true
                        }
                    }
                }
            });
        }

        function populateCustomYearSelector() {
            const select = document.getElementById('chartCustomYear');
            if (!select) return;
            
            const currentYear = new Date().getFullYear();
            const years = new Set();
            years.add(currentYear);
            
            // Get years from transactions
            transactions.forEach(t => {
                if (t.date) {
                    const year = new Date(t.date).getFullYear();
                    years.add(year);
                }
            });
            
            const sortedYears = Array.from(years).sort((a, b) => b - a);
            select.innerHTML = sortedYears.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('');
            
            // Set default month to current month
            const currentMonth = new Date().getMonth();
            document.getElementById('chartCustomMonth').value = currentMonth;
        }

        function safeDestroyChart() {
            const canvas = document.getElementById('expenseChart');
            if (expenseChartInstance) {
                expenseChartInstance.destroy();
                expenseChartInstance = null;
            }
            const existing = Chart.getChart(canvas);
            if (existing) existing.destroy();
            const ctx2 = canvas.getContext('2d');
            ctx2.clearRect(0, 0, canvas.width, canvas.height);
        }

        function renderChart() {
            safeDestroyChart();
            const ctx = document.getElementById('expenseChart').getContext('2d');
            const chartTypeMode = document.getElementById('chartTypeMode').value;
            
            if (chartTypeMode === 'categories') {
                renderCategoriesChart(ctx);
            } else {
                renderEvolutionChart(ctx);
            }
        }

        async function handleTransactionSubmit(e) {
            e.preventDefault();
            
            // Validate BEFORE disabling the button
            const fd=new FormData(e.target);
            const amountStr=fd.get('amount').replace(',','.');
            const inputAmount=parseFloat(amountStr);
            const installments=parseInt(fd.get('installments'))||1;
            const amountType=fd.get('amountType');
            if(isNaN(inputAmount)||inputAmount<=0){showToast('Por favor, insira um valor válido maior que zero.', 'error');return;}
            if(installments<1){showToast('O número de parcelas deve ser pelo menos 1.', 'error');return;}

            // Check prerequisites before disabling button
            if (!currentUser) {
                showToast('Sessão expirada. Faça login novamente.', 'error');
                return;
            }
            if (!householdCode) {
                showToast('Casa não configurada. Faça login novamente.', 'error');
                return;
            }
            
            const btn = document.getElementById('saveTransactionBtn');
            const btnText = document.getElementById('saveBtnText');
            const spinner = document.getElementById('saveBtnSpinner');
            
            btn.disabled = true;
            btnText.textContent = 'Salvando...';
            spinner.classList.remove('hidden');
            
            try {
                const baseDate=new Date(fd.get('date')+'T12:00:00');
                const baseDesc=fd.get('description')||fd.get('category');
                let instAmt = amountType==='total' ? Math.round((inputAmount/installments)*100)/100 : inputAmount;

                if (editingId) {
                    const currentTx = transactions.find(t => t.id === editingId);
                    if (!currentTx) { editingId=null; throw new Error('Transação não encontrada.'); }

                    const groupId = currentTx.groupId || currentTx.id;
                    const group = transactions.filter(t => t.groupId === groupId)
                        .sort((a,b) => (a.installmentNum||1) - (b.installmentNum||1));
                    const currentIdx = group.findIndex(t => t.id === editingId);
                    const wasGrouped = group.length > 1;

                    // Find the base date for new installments: the date of the current transaction being edited
                    const editBaseDate = new Date(fd.get('date') + 'T12:00:00');

                    // Step 1: Delete all transactions in the group from currentIdx forward
                    const toDelete = group.slice(currentIdx);
                    for (const t of toDelete) {
                        transactions = transactions.filter(tx => tx.id !== t.id);
                        await deleteTransactionFromFirestore(t.id);
                    }

                    // Step 2: Create new installments from the edited transaction's date forward
                    const newGroupId = wasGrouped ? groupId : Date.now();
                    const userId = currentTx.userId || currentUser.uid;
                    const userName = currentTx.userName || getMyDisplayName();

                    // Calculate the total installment number to continue numbering
                    const startNum = currentIdx + 1; // 1-based installment number of current
                    const totalFromStart = (wasGrouped ? group.length : 1) - currentIdx + (installments - 1);

                    for (let i = 0; i < installments; i++) {
                        const cd = new Date(editBaseDate);
                        cd.setMonth(editBaseDate.getMonth() + i);
                        const ds = `${cd.getFullYear()}-${String(cd.getMonth()+1).padStart(2,'0')}-${String(cd.getDate()).padStart(2,'0')}`;
                        const instNum = startNum + i;
                        const totalInst = wasGrouped ? (currentIdx + installments) : installments;
                        let desc = baseDesc;
                        if (totalInst > 1) desc = `${baseDesc} (${instNum}/${totalInst})`;
                        const t = {
                            id: newGroupId + 10000 + i,
                            type: fd.get('type'),
                            amount: instAmt,
                            category: fd.get('category'),
                            date: ds,
                            description: desc,
                            userId: userId,
                            userName: userName,
                            isAnonymous: isAnonymous,
                            groupId: newGroupId,
                            installmentNum: instNum,
                            totalInstallments: totalInst
                        };
                        transactions.push(t);
                        await saveSingleTransaction(t);
                    }

                    editingId = null;

                } else {
                    const baseId = Date.now();
                    for(let i=0;i<installments;i++){
                        const cd=new Date(baseDate); cd.setMonth(baseDate.getMonth()+i);
                        const ds=`${cd.getFullYear()}-${String(cd.getMonth()+1).padStart(2,'0')}-${String(cd.getDate()).padStart(2,'0')}`;
                        let desc=baseDesc; if(installments>1) desc=`${baseDesc} (${i+1}/${installments})`;
                        const t={
                            id:baseId+i,
                            type:fd.get('type'),
                            amount:instAmt,
                            category:fd.get('category'),
                            date:ds,
                            description:desc,
                            userId:currentUser.uid,
                            userName:getMyDisplayName(),
                            isAnonymous:isAnonymous,
                            groupId: baseId,
                            installmentNum: i+1,
                            totalInstallments: installments
                        };
                        transactions.push(t);
                        await saveSingleTransaction(t);
                    }
                }
                
                updateUI();
                closeModal();
                e.target.reset();
                const di=e.target.querySelector('input[name="date"]'); if(di)di.valueAsDate=new Date();
                
                showToast('Transação salva com sucesso!');
                
            } catch (error) {
                console.error('Error saving transaction:', error);
                showToast(`Erro ao salvar: ${error.message}`, 'error');
            } finally {
                btn.disabled = false;
                btnText.textContent = 'Salvar Transação';
                spinner.classList.add('hidden');
            }
        }

        function getDebtGroup(tx) {
            if (!tx) return [];
            const groupId = tx.groupId || tx.id;
            const group = transactions
                .filter(item => (item.groupId || item.id) === groupId)
                .sort((a, b) => {
                    const an = a.installmentNum || 1;
                    const bn = b.installmentNum || 1;
                    if (an !== bn) return an - bn;
                    return new Date(a.date) - new Date(b.date);
                });
            return group.length ? group : [tx];
        }

        function getRemainingDebtItems(tx) {
            const group = getDebtGroup(tx);
            const currentNum = tx.installmentNum || 1;
            return group.filter(item => {
                if ((item.installmentNum || 1) >= currentNum) return true;
                return new Date(item.date) >= new Date(tx.date);
            });
        }

        function getRemainingDebtAmount(tx) {
            return getRemainingDebtItems(tx).reduce((sum, item) => sum + Number(item.amount || 0), 0);
        }

        async function removeFutureDebtInstallments(tx) {
            const currentNum = tx.installmentNum || 1;
            const currentDate = new Date(tx.date);
            const toRemove = getDebtGroup(tx).filter(item => {
                if (item.id === tx.id) return false;
                if ((item.installmentNum || 1) > currentNum) return true;
                return new Date(item.date) > currentDate;
            });
            for (const item of toRemove) {
                transactions = transactions.filter(t => t.id !== item.id);
                await deleteTransactionFromFirestore(item.id);
            }
            return toRemove.length;
        }

        function buildDebtTransaction(original, overrides = {}) {
            return {
                id: overrides.id || Date.now(),
                type: 'expense',
                amount: overrides.amount,
                category: original.category,
                date: overrides.date,
                description: overrides.description,
                userId: original.userId || currentUser.uid,
                userName: original.userName || getMyDisplayName(),
                isAnonymous: original.isAnonymous || false,
                groupId: overrides.groupId || overrides.id || Date.now(),
                installmentNum: overrides.installmentNum || 1,
                totalInstallments: overrides.totalInstallments || 1,
                paymentStatus: overrides.paymentStatus || 'pending',
                debtOriginId: original.id,
                createdFromUnpaidDebt: true
            };
        }

        async function markDebtStatus(id, status) {
            const tx = transactions.find(t => t.id === id);
            if (!tx || tx.type !== 'expense') return;

            if (status === 'paid') {
                tx.paymentStatus = 'paid';
                tx.paidAt = new Date().toISOString();
                tx.unpaidAt = null;
                await saveSingleTransaction(tx);
                updateUI();
                showToast('Dívida marcada como paga');
                return;
            }

            currentDebtRolloverId = id;
            setupDebtRolloverControls();
            const modal = document.getElementById('debtRolloverModal');
            const form = document.getElementById('debtRolloverForm');
            const summary = document.getElementById('debtRolloverSummary');
            if (form) {
                form.reset();
                form.rolloverAction.value = 'mark_only';
                document.getElementById('reparcelFields').style.display = 'none';
            }
            const remaining = getRemainingDebtAmount(tx);
            summary.textContent = `${baseDescriptionOf(tx)} · parcela atual ${formatCurrency(tx.amount)} · restante ${formatCurrency(remaining)}`;
            modal.style.display = 'block';
        }

        function closeDebtRolloverModal() {
            document.getElementById('debtRolloverModal').style.display = 'none';
            currentDebtRolloverId = null;
        }

        async function confirmDebtRollover(e) {
            e.preventDefault();
            const tx = transactions.find(t => t.id === currentDebtRolloverId);
            if (!tx) { closeDebtRolloverModal(); return; }

            const fd = new FormData(e.target);
            const action = fd.get('rolloverAction');
            const baseDesc = baseDescriptionOf(tx);
            const nextDate = addMonthsToDate(tx.date, 1);
            let created = 0;
            let removedFuture = 0;

            try {
                tx.paymentStatus = 'unpaid';
                tx.unpaidAt = new Date().toISOString();
                tx.paidAt = null;
                await saveSingleTransaction(tx);

                if (action === 'current_next') {
                    const id = Date.now();
                    const newTx = buildDebtTransaction(tx, {
                        id,
                        groupId: id,
                        amount: Number(tx.amount || 0),
                        date: nextDate,
                        description: `${baseDesc} - parcela pendente`
                    });
                    transactions.push(newTx);
                    await saveSingleTransaction(newTx);
                    created = 1;
                } else if (action === 'remaining_next') {
                    const amount = getRemainingDebtAmount(tx);
                    removedFuture = await removeFutureDebtInstallments(tx);
                    const id = Date.now();
                    const newTx = buildDebtTransaction(tx, {
                        id,
                        groupId: id,
                        amount,
                        date: nextDate,
                        description: `${baseDesc} - dívida reprogramada`
                    });
                    transactions.push(newTx);
                    await saveSingleTransaction(newTx);
                    created = 1;
                } else if (action === 'reparcel') {
                    const baseMode = fd.get('reparcelBase');
                    const baseAmount = baseMode === 'remaining' ? getRemainingDebtAmount(tx) : Number(tx.amount || 0);
                    const downPayment = Math.max(0, parseFloat(String(fd.get('downPayment') || '0').replace(',', '.')) || 0);
                    const installments = Math.max(1, parseInt(fd.get('newInstallments')) || 1);
                    const typedInstallmentAmount = parseFloat(String(fd.get('newInstallmentAmount') || '').replace(',', '.'));
                    const remainder = Math.max(0, Math.round((baseAmount - downPayment) * 100) / 100);

                    if (baseMode === 'remaining') removedFuture = await removeFutureDebtInstallments(tx);

                    if (remainder <= 0) {
                        tx.paymentStatus = 'paid';
                        tx.paidAt = new Date().toISOString();
                        tx.unpaidAt = null;
                        await saveSingleTransaction(tx);
                    } else {
                        const installmentAmount = !isNaN(typedInstallmentAmount) && typedInstallmentAmount > 0
                            ? Math.round(typedInstallmentAmount * 100) / 100
                            : Math.round((remainder / installments) * 100) / 100;
                        const groupId = Date.now();
                        for (let i = 0; i < installments; i++) {
                            const newTx = buildDebtTransaction(tx, {
                                id: groupId + i,
                                groupId,
                                amount: installmentAmount,
                                date: addMonthsToDate(tx.date, i + 1),
                                description: `${baseDesc} - reparcelado (${i + 1}/${installments})`,
                                installmentNum: i + 1,
                                totalInstallments: installments
                            });
                            transactions.push(newTx);
                            await saveSingleTransaction(newTx);
                            created++;
                        }
                    }
                }

                closeDebtRolloverModal();
                updateUI();
                const parts = ['Dívida marcada como não paga'];
                if (removedFuture) parts.push(`${removedFuture} parcelas futuras substituídas`);
                if (created) parts.push(`${created} cobrança(s) criada(s)`);
                showToast(parts.join('. '));
            } catch (error) {
                console.error('Error updating debt status:', error);
                showToast(`Erro ao atualizar dívida: ${error.message}`, 'error');
            }
        }

        async function deleteTransaction(id) {
            const tx = transactions.find(t => t.id === id);
            if (!tx) return;

            const groupId = tx.groupId || tx.id;
            const group = transactions.filter(t => t.groupId === groupId);
            const isGrouped = group.length > 1;

            let deleteAll = false;
            if (isGrouped) {
                const choice = confirm(
                    `Esta transação faz parte de ${group.length} parcelas.\n\n` +
                    `OK = Excluir TODAS as ${group.length} parcelas\n` +
                    `Cancelar = Excluir SOMENTE esta parcela`
                );
                deleteAll = choice;
            } else {
                if (!confirm('Deseja excluir esta transação?')) return;
            }

            try {
                if (deleteAll) {
                    // Delete entire group
                    for (const t of group) {
                        transactions = transactions.filter(tx2 => tx2.id !== t.id);
                        await deleteTransactionFromFirestore(t.id);
                    }
                    showToast(`${group.length} parcelas excluídas`);
                } else {
                    // Delete only this one
                    transactions = transactions.filter(t => t.id !== id);
                    await deleteTransactionFromFirestore(id);
                    showToast('Transação excluída');
                }
                updateUI();
            } catch (error) {
                console.error('Error deleting:', error);
                showToast(`Erro ao excluir: ${error.message}`, 'error');
            }
        }

        async function clearAllData() {
            if(!confirm('ATENÇÃO: Isso apagará TODAS as transações para ambos. Tem certeza?')) return;
            try {
                transactions=[];
                await clearAllTransactionsInFirestore();
                updateUI();
                showToast('Todas as transações foram excluídas');
            } catch (error) {
                console.error('Error clearing:', error);
                showToast(`Erro ao limpar: ${error.message}`, 'error');
            }
        }

        function populateCategorySelects() {
            document.querySelectorAll('select[name="category"]').forEach(sel=>{
                const cv=sel.value; sel.innerHTML='';
                categories.forEach(cat=>{const o=document.createElement('option');o.value=cat;o.textContent=cat;if(cat===cv)o.selected=true;sel.appendChild(o);});
            });
        }

        function openCategoryModal(){renderCategoriesList();document.getElementById('categoryModal').style.display='block';}
        function closeCategoryModal(){document.getElementById('categoryModal').style.display='none';}

        function renderCategoriesList(){
            const c=document.getElementById('categoriesList');
            c.innerHTML='';
            categoryMeta = normalizeCategoryMeta(categoryMeta);
            categories.forEach(cat=>{
                const color = getCategoryColor(cat);
                const d=document.createElement('div');
                d.className='category-row';
                d.style.borderLeft = `3px solid ${color}`;
                d.style.background = `linear-gradient(90deg, ${hexToRgba(color, 0.12)}, rgba(255,255,255,0.04))`;

                const left=document.createElement('div');
                left.className='flex items-center gap-3 min-w-0';
                const avatar=document.createElement('div');
                avatar.innerHTML=categoryAvatarHtml(cat);
                const copy=document.createElement('div');
                copy.className='min-w-0';
                const name=document.createElement('div');
                name.className='text-sm font-semibold truncate';
                name.style.color=color;
                name.textContent=cat;
                const helper=document.createElement('div');
                helper.className='text-[11px] text-zinc-500 truncate';
                helper.textContent=getCategoryLogo(cat) ? 'Logo ativa · cor sincronizada' : 'Sem logo · cor manual';
                copy.appendChild(name);
                copy.appendChild(helper);
                left.appendChild(avatar);
                left.appendChild(copy);

                const tools=document.createElement('div');
                tools.className='category-tools';

                const colorInput=document.createElement('input');
                colorInput.type='color';
                colorInput.value=color;
                colorInput.className='category-color-input';
                colorInput.title='Alterar cor da categoria';
                colorInput.addEventListener('change', (e)=>updateCategoryColor(cat, e.target.value));

                const fileInput=document.createElement('input');
                fileInput.type='file';
                fileInput.accept='image/*';
                fileInput.style.display='none';
                fileInput.addEventListener('change', (e)=>handleCategoryLogoUpload(e, cat));

                const uploadBtn=document.createElement('button');
                uploadBtn.type='button';
                uploadBtn.className='category-chip-btn';
                uploadBtn.textContent=getCategoryLogo(cat) ? 'Trocar logo' : 'Adicionar logo';
                uploadBtn.addEventListener('click', ()=>fileInput.click());

                const autoBtn=document.createElement('button');
                autoBtn.type='button';
                autoBtn.className='category-chip-btn';
                autoBtn.textContent='Cor da logo';
                autoBtn.disabled=!getCategoryLogo(cat);
                autoBtn.style.opacity=getCategoryLogo(cat) ? '1' : '0.45';
                autoBtn.style.cursor=getCategoryLogo(cat) ? 'pointer' : 'not-allowed';
                autoBtn.addEventListener('click', ()=>autoColorFromLogo(cat));

                const removeLogoBtn=document.createElement('button');
                removeLogoBtn.type='button';
                removeLogoBtn.className='category-chip-btn';
                removeLogoBtn.textContent='Remover logo';
                removeLogoBtn.style.display=getCategoryLogo(cat) ? 'inline-flex' : 'none';
                removeLogoBtn.addEventListener('click', ()=>removeCategoryLogo(cat));

                const deleteBtn=document.createElement('button');
                deleteBtn.type='button';
                deleteBtn.className='text-zinc-500 hover:text-danger transition-colors p-1';
                deleteBtn.title='Excluir';
                deleteBtn.innerHTML='<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
                deleteBtn.addEventListener('click', ()=>deleteCategory(cat));

                tools.appendChild(colorInput);
                tools.appendChild(uploadBtn);
                tools.appendChild(autoBtn);
                tools.appendChild(removeLogoBtn);
                tools.appendChild(deleteBtn);
                tools.appendChild(fileInput);
                d.appendChild(left);
                d.appendChild(tools);
                c.appendChild(d);
            });
        }

        async function addCategory(){
            const input=document.getElementById('newCategoryInput');
            const name=input.value.trim(); if(!name) return;
            if(categories.includes(name)){alert('Esta categoria já existe.');return;}
            categories.push(name);
            categoryMeta[name] = { color: getDefaultCategoryColor(name), logo: '' };
            await saveSettingsToFirestore();
            input.value=''; renderCategoriesList(); populateCategorySelects();
            showToast('Categoria adicionada');
        }

        async function deleteCategory(name){
            if(categories.length<=1){alert('Você deve ter pelo menos uma categoria.');return;}
            if(!confirm(`Deseja excluir a categoria "${name}"?`)) return;
            categories=categories.filter(c=>c!==name);
            delete categoryMeta[name];
            await saveSettingsToFirestore();
            renderCategoriesList(); populateCategorySelects(); updateUI();
            showToast('Categoria excluída');
        }

        async function updateCategoryColor(name, color) {
            if (!isValidHexColor(color)) return;
            categoryMeta[name] = { ...getCategoryMeta(name), color };
            await saveSettingsToFirestore();
            renderCategoriesList();
            updateUI();
            showToast('Cor da categoria atualizada');
        }

        function fileToDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
                reader.readAsDataURL(file);
            });
        }

        function loadImageFromDataUrl(dataUrl) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Imagem inválida.'));
                img.src = dataUrl;
            });
        }

        async function resizeLogoToDataUrl(file) {
            const original = await fileToDataUrl(file);
            const img = await loadImageFromDataUrl(original);
            const maxSize = 96;
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            const width = Math.max(1, Math.round(img.width * scale));
            const height = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            return canvas.toDataURL('image/webp', 0.86);
        }

        function rgbToHex(r, g, b) {
            return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
        }

        async function extractDominantColorFromLogo(dataUrl) {
            const img = await loadImageFromDataUrl(dataUrl);
            const size = 36;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, size, size);
            const data = ctx.getImageData(0, 0, size, size).data;
            const buckets = new Map();
            for (let i = 0; i < data.length; i += 4) {
                const a = data[i + 3];
                if (a < 80) continue;
                const r = data[i], g = data[i + 1], b = data[i + 2];
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                const saturation = max === 0 ? 0 : (max - min) / max;
                const brightness = max / 255;
                if (brightness < 0.12 || brightness > 0.96 || saturation < 0.10) continue;
                const key = `${Math.round(r / 24) * 24},${Math.round(g / 24) * 24},${Math.round(b / 24) * 24}`;
                const current = buckets.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
                const weight = 1 + saturation * 2;
                current.weight += weight;
                current.r += r * weight;
                current.g += g * weight;
                current.b += b * weight;
                buckets.set(key, current);
            }
            if (!buckets.size) return '#7c3aed';
            const dominant = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
            return rgbToHex(dominant.r / dominant.weight, dominant.g / dominant.weight, dominant.b / dominant.weight);
        }

        async function handleCategoryLogoUpload(event, name) {
            const file = event?.target?.files?.[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                alert('Envie um arquivo de imagem.');
                return;
            }
            try {
                const logo = await resizeLogoToDataUrl(file);
                const color = await extractDominantColorFromLogo(logo);
                categoryMeta[name] = { ...getCategoryMeta(name), logo, color };
                await saveSettingsToFirestore();
                renderCategoriesList();
                updateUI();
                showToast('Logo adicionada e cor ajustada automaticamente');
            } catch (error) {
                console.error('Erro ao processar logo:', error);
                showToast(`Erro ao processar logo: ${error.message}`, 'error');
            } finally {
                if (event?.target) event.target.value = '';
            }
        }

        async function autoColorFromLogo(name) {
            const logo = getCategoryLogo(name);
            if (!logo) {
                alert('Adicione uma logo antes de gerar a cor automática.');
                return;
            }
            const color = await extractDominantColorFromLogo(logo);
            categoryMeta[name] = { ...getCategoryMeta(name), color };
            await saveSettingsToFirestore();
            renderCategoriesList();
            updateUI();
            showToast('Cor recalculada pela logo');
        }

        async function removeCategoryLogo(name) {
            categoryMeta[name] = { ...getCategoryMeta(name), logo: '' };
            await saveSettingsToFirestore();
            renderCategoriesList();
            updateUI();
            showToast('Logo removida');
        }

        // ── Profile / User Name ──
        function getMyDisplayName() {
            return meuNome || currentUser?.displayName || currentUser?.email || 'Desconhecido';
        }

        async function loadUserDisplayName() {
            if (!currentUser) return '';
            try {
                const userRef = doc(db, 'users', currentUser.uid);
                const userSnap = await withTimeout(getDoc(userRef));
                if (userSnap.exists()) {
                    const data = userSnap.data();
                    isAnonymous = data.isAnonymous || false;
                    return data.name || '';
                }
            } catch (e) {
                console.warn('Could not load user name:', e);
            }
            return '';
        }

        function openProfileModal() {
            document.getElementById('profileModal').style.display = 'block';
            document.getElementById('profileNameInput').value = getMyDisplayName();
            document.getElementById('profileEmailDisplay').textContent = currentUser?.email || '';
            document.getElementById('profileAnonymousToggle').checked = isAnonymous;
        }

        function closeProfileModal() {
            document.getElementById('profileModal').style.display = 'none';
        }

        async function handleProfileSubmit(e) {
            e.preventDefault();
            const newName = document.getElementById('profileNameInput').value.trim();
            const newAnonymous = document.getElementById('profileAnonymousToggle').checked;
            if (!newName) { showToast('Por favor, insira um nome.', 'error'); return; }

            const btn = document.getElementById('saveProfileBtn');
            const btnText = document.getElementById('saveProfileBtnText');
            const spinner = document.getElementById('saveProfileSpinner');

            btn.disabled = true;
            btnText.textContent = 'Salvando...';
            spinner.classList.remove('hidden');

            try {
                const oldName = meuNome || currentUser.displayName || currentUser.email;

                // Save to Firestore user doc
                await withTimeout(setDoc(doc(db, 'users', currentUser.uid), {
                    name: newName,
                    email: currentUser.email,
                    householdCode: householdCode || null,
                    isAnonymous: newAnonymous
                }, { merge: true }));

                // Update Firebase Auth displayName
                try { await updateProfile(currentUser, { displayName: newName }); } catch(e) {}

                meuNome = newName;
                isAnonymous = newAnonymous;

                // Update current user's existing transactions to reflect new name and anonymous status
                const updatedIds = [];
                for (const t of transactions) {
                    if (t.userId === currentUser.uid) {
                        let needsUpdate = false;
                        if (t.userName !== newName) {
                            t.userName = newName;
                            needsUpdate = true;
                        }
                        if (t.isAnonymous !== newAnonymous) {
                            t.isAnonymous = newAnonymous;
                            needsUpdate = true;
                        }
                        if (needsUpdate) {
                            await saveSingleTransaction(t);
                            updatedIds.push(t.id);
                        }
                    }
                }

                // Update header display
                document.getElementById('userNameDisplay').textContent = newName;

                updateUI();
                closeProfileModal();
                const msg = [];
                if (updatedIds.length > 0) msg.push(`${updatedIds.length} transações atualizadas`);
                msg.push(newAnonymous ? 'Modo anônimo ativado' : 'Modo anônimo desativado');
                showToast(msg.join('. ') + '!');

            } catch (error) {
                console.error('Error saving profile:', error);
                showToast(`Erro ao salvar: ${error.message}`, 'error');
            } finally {
                btn.disabled = false;
                btnText.textContent = 'Salvar Configurações';
                spinner.classList.add('hidden');
            }
        }

        function openModal(transaction=null){
            const modal=document.getElementById('transactionModal'), form=document.getElementById('transactionForm');
            form.reset();
            const di=form.querySelector('input[name="date"]'); if(di)di.valueAsDate=new Date();
            populateCategorySelects();

            // Track category changes to update description
            const categorySelect = form.querySelector('select[name="category"]');
            const descriptionInput = form.querySelector('input[name="description"]');
            let categoryChanged = false;

            // Usa onchange (nao addEventListener) para nao empilhar handlers a cada abertura do modal
            categorySelect.onchange = () => {
                categoryChanged = true;
                // Auto-update description to match new category (only if empty or was auto-set)
                if (!descriptionInput.value || descriptionInput.value === categorySelect.options[0]?.text || descriptionInput.dataset.autoCategory === descriptionInput.value) {
                    descriptionInput.value = categorySelect.value;
                    descriptionInput.dataset.autoCategory = categorySelect.value;
                }
            };

            if(transaction){
                editingId=transaction.id;
                form.querySelector(`input[name="type"][value="${transaction.type}"]`).checked=true;
                form.querySelector('input[name="amount"]').value=transaction.amount;
                categorySelect.value=transaction.category;
                if(!categorySelect.value){const o=document.createElement('option');o.value=transaction.category;o.textContent=transaction.category+' (Removida)';o.selected=true;categorySelect.appendChild(o);}
                form.querySelector('input[name="date"]').value=transaction.date;

                // Strip installment suffix from description for clean editing
                let cleanDesc = (transaction.description === transaction.category) ? '' : transaction.description;
                cleanDesc = cleanDesc.replace(/\s*\(\d+\/\d+\)\s*$/, '');
                descriptionInput.value = cleanDesc;
                descriptionInput.dataset.autoCategory = cleanDesc; // Mark as auto-set

                // Show remaining installments if grouped
                const groupId = transaction.groupId || transaction.id;
                const group = transactions.filter(t => t.groupId === groupId);
                if (group.length > 1) {
                    const remaining = group.filter(t => (t.installmentNum || 1) >= (transaction.installmentNum || 1)).length;
                    form.querySelector('input[name="installments"]').value = remaining;
                } else {
                    form.querySelector('input[name="installments"]').value = 1;
                }

                // Determine amount type: if it's a grouped tx with totalInstallments, show as installment value
                // (since amount is already the per-installment value, set amountType to 'installment')
                if (group.length > 1) {
                    form.querySelector('input[name="amountType"][value="installment"]').checked = true;
                } else {
                    form.querySelector('input[name="amountType"][value="total"]').checked = true;
                }

                modal.querySelector('h3').textContent = group.length > 1
                    ? `Editar Transação (Parcela ${transaction.installmentNum||1}/${transaction.totalInstallments||group.length})`
                    : 'Editar Transação';
                document.getElementById('saveBtnText').textContent='Atualizar Transação';
            } else {
                editingId=null;
                modal.querySelector('h3').textContent='Nova Transação';
                document.getElementById('saveBtnText').textContent='Salvar Transação';
            }
            modal.style.display='block';
        }

        function editTransaction(id){const t=transactions.find(i=>i.id===id);if(t)openModal(t);}
        function closeModal(){document.getElementById('transactionModal').style.display='none';editingId=null;}

        document.addEventListener('keydown',(e)=>{if(e.key==='Escape'){closeModal();closeCategoryModal();closeDebtRolloverModal();}});

        function showLoginLoading(on){
            document.getElementById('loginBtnText').textContent=on?'Entrando...':'Entrar';
            document.getElementById('loginSpinner').classList.toggle('hidden',!on);
        }
        function showRegLoading(on){
            document.getElementById('regBtnText').textContent=on?'Criando...':'Criar Conta';
            document.getElementById('regSpinner').classList.toggle('hidden',!on);
        }
        function showLoginError(msg){const el=document.getElementById('loginError');el.textContent=msg;el.classList.remove('hidden');}
        function hideLoginError(){document.getElementById('loginError').classList.add('hidden');}
        function getPtBrError(code){
            const map={'auth/invalid-email':'E-mail inválido.','auth/user-not-found':'Usuário não encontrado.','auth/wrong-password':'Senha incorreta.','auth/invalid-credential':'E-mail ou senha incorretos.','auth/email-already-in-use':'Este e-mail já está cadastrado.','auth/weak-password':'A senha deve ter pelo menos 6 caracteres.','auth/network-request-failed':'Erro de conexão. Verifique sua internet.'};
            return map[code]||'Ocorreu um erro. Tente novamente.';
        }
