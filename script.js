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
        let householdMembers = [];
        let householdCreatedBy = null;
        let savingsGoals = []; // metas de economia (pessoais, uma lista por usuário)
        let savingsInstallments = []; // parcelas mensais de cada meta
        let savingsInputMode = 'total'; // 'total' (valor total ÷ parcelas) | 'installment' (parcela × parcelas)
        let currentView = 'dashboard'; // 'dashboard' | 'goals'

        const DEFAULT_CATEGORIES = ['Alimentação','Moradia','Transporte','Lazer','Saúde','Educação','Salário','Investimentos','Outros'];

        // ── Tema (claro/escuro) ──
        function isDarkMode() { return document.documentElement.classList.contains('dark'); }
        function chartLegendColor() { return isDarkMode() ? '#a1a1aa' : '#52525b'; }
        function chartTickColor() { return isDarkMode() ? '#a1a1aa' : '#71717a'; }
        function chartGridColor() { return isDarkMode() ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)'; }

        // ── Filtro de histórico (tipo) - padrão "Despesas", lembrando a última escolha ──
        function applyStoredFilterType() {
            const typeEl = document.getElementById('filterType');
            if (!typeEl) return;
            let saved = null;
            try { saved = localStorage.getItem('fincontrol_filterType'); } catch (e) {}
            typeEl.value = (saved === 'all' || saved === 'expense' || saved === 'income') ? saved : 'expense';
        }
        function onFilterTypeChange() {
            const typeEl = document.getElementById('filterType');
            if (typeEl) { try { localStorage.setItem('fincontrol_filterType', typeEl.value); } catch (e) {} }
            updateUI();
        }
        applyStoredFilterType();
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
            return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-900/5 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border border-zinc-900/8 dark:border-white/5">${categoryAvatarHtml(category, 'cat-pill-logo')}<span>${escapeHtml(category)}</span></span>`;
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
            // A cor da borda esquerda identifica a CATEGORIA de forma consistente;
            // o status (pago/pendente/não pago) já é comunicado pelo selo e pela seção.
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
        window.openSettingsModal = openSettingsModal;
        window.closeSettingsModal = closeSettingsModal;
        window.openMembersModal = openMembersModal;
        window.closeMembersModal = closeMembersModal;
        window.removeMember = removeMember;
        window.openThemeModal = openThemeModal;
        window.closeThemeModal = closeThemeModal;
        window.setTheme = setTheme;
        window.onFilterTypeChange = onFilterTypeChange;
        window.switchView = switchView;
        window.openGoalModal = openGoalModal;
        window.closeGoalModal = closeGoalModal;
        window.setSavingsInputMode = setSavingsInputMode;
        window.updateGoalPreview = updateGoalPreview;
        window.handleGoalSubmit = handleGoalSubmit;
        window.deleteSavingsGoal = deleteSavingsGoal;
        window.markSavingsInstallment = markSavingsInstallment;
        window.openPartialSaveModal = openPartialSaveModal;
        window.closePartialSaveModal = closePartialSaveModal;
        window.handlePartialSaveSubmit = handlePartialSaveSubmit;

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
                const hhData = householdSnap.exists() ? householdSnap.data() : {};
                const members = hhData.members || [];
                householdMembers = members;
                householdCreatedBy = hhData.createdBy || members[0] || null;
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

                const goalsSnap = await withTimeout(getDocs(collection(db, 'households', householdCode, 'savingsGoals')));
                savingsGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                const instSnap = await withTimeout(getDocs(collection(db, 'households', householdCode, 'savingsInstallments')));
                savingsInstallments = instSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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
            if (houseCards.length) {
                const showHouseCards = householdMemberCount > 1;
                houseCards.forEach(card => card.classList.toggle('hidden', !showHouseCards));
                // A grade (grid-cols-2 no mobile, lg:grid-cols-4 no desktop) é fixa;
                // os cards da casa simplesmente somem/aparecem, reorganizando as fileiras.
            }
            updateChartFilterVisibility();
        }

        // O filtro "Casa" x "Minhas" do gráfico só faz sentido quando a casa tem
        // mais de 1 morador — com um usuário só, os dois dariam o mesmo resultado.
        function updateChartFilterVisibility() {
            const btnAll = document.getElementById('chartFilterAll');
            const btnUser = document.getElementById('chartFilterUser');
            if (!btnAll || !btnUser) return;
            const showFilter = householdMemberCount > 1;
            btnAll.classList.toggle('hidden', !showFilter);
            btnUser.classList.toggle('hidden', !showFilter);
            if (!showFilter && chartFilter !== 'all') {
                setChartFilter('all');
            }
        }

        function copyHouseholdCode() {
            if (!householdCode) return;
            navigator.clipboard.writeText(householdCode).then(() => {
                const el = document.getElementById('householdCodeDisplay');
                const original = el.textContent;
                el.textContent = 'Copiado!';
                setTimeout(() => { el.textContent = original; }, 1500);
                showToast('Código copiado! Envie para quem você quer convidar.');
            });
        }

        // ── Configurações (menu) ──
        function openSettingsModal() {
            document.getElementById('settingsModal').style.display = 'block';
        }
        function closeSettingsModal() {
            document.getElementById('settingsModal').style.display = 'none';
        }

        // ── Integrantes da Casa ──
        function openMembersModal() {
            document.getElementById('membersModal').style.display = 'block';
            document.getElementById('membersHouseholdCode').textContent = householdCode || '';
            renderMembersList();
        }
        function closeMembersModal() {
            document.getElementById('membersModal').style.display = 'none';
        }

        async function renderMembersList() {
            const container = document.getElementById('membersList');
            container.innerHTML = '<div style="text-align:center;padding:20px;color:rgb(var(--c-text-faint));font-size:13px;">Carregando integrantes...</div>';

            const isCreator = currentUser && householdCreatedBy === currentUser.uid;
            const members = householdMembers.length ? householdMembers : [currentUser?.uid].filter(Boolean);

            try {
                const rows = await Promise.all(members.map(async (uid) => {
                    let name = 'Membro';
                    let email = '';
                    try {
                        const uSnap = await withTimeout(getDoc(doc(db, 'users', uid)));
                        if (uSnap.exists()) {
                            name = uSnap.data().name || 'Membro';
                            email = uSnap.data().email || '';
                        }
                    } catch (e) { /* ignore */ }
                    const isSelf = uid === currentUser?.uid;
                    const isOwner = uid === householdCreatedBy;
                    const initials = (name || '?').trim().slice(0, 2).toUpperCase();
                    const canRemove = isCreator && !isSelf;
                    return `
                        <div class="member-row">
                            <span class="member-avatar">${escapeHtml(initials)}</span>
                            <div style="flex:1;min-width:0;">
                                <div class="member-name" style="display:flex;align-items:center;flex-wrap:wrap;">
                                    ${escapeHtml(name)}
                                    ${isSelf ? '<span class="member-tag">Você</span>' : ''}
                                    ${isOwner ? '<span class="member-tag" style="background:rgb(var(--c-accent) / 0.15);color:rgb(var(--c-accent));">Criador(a)</span>' : ''}
                                </div>
                                ${email ? `<div style="font-size:11px;color:rgb(var(--c-text-faint));">${escapeHtml(email)}</div>` : ''}
                            </div>
                            ${canRemove ? `<button class="member-remove-btn" onclick="removeMember('${uid}', '${escapeHtml(name).replace(/'/g, "\\'")}')">Remover</button>` : ''}
                        </div>`;
                }));
                container.innerHTML = rows.join('') || '<div style="text-align:center;padding:20px;color:rgb(var(--c-text-faint));font-size:13px;">Nenhum integrante encontrado.</div>';

                if (!isCreator) {
                    container.innerHTML += '<div style="text-align:center;padding-top:10px;font-size:11px;color:rgb(var(--c-text-faint));">Apenas quem criou a casa pode remover integrantes.</div>';
                }
            } catch (error) {
                console.error('Erro ao carregar integrantes:', error);
                container.innerHTML = '<div style="text-align:center;padding:20px;color:rgb(var(--c-danger));font-size:13px;">Erro ao carregar integrantes.</div>';
            }
        }

        async function removeMember(uid, name) {
            if (!currentUser || householdCreatedBy !== currentUser.uid) {
                showToast('Apenas quem criou a casa pode remover integrantes.', 'error');
                return;
            }
            if (uid === currentUser.uid) return;

            const confirmed = confirm(`Remover ${name} da casa?\n\nTodas as transações registradas por essa pessoa serão apagadas permanentemente. Essa ação não pode ser desfeita.`);
            if (!confirmed) return;

            try {
                showToast('Removendo integrante...');

                // Delete this member's transactions in the household
                const toDelete = transactions.filter(t => t.userId === uid);
                for (const t of toDelete) {
                    await deleteTransactionFromFirestore(t.id);
                }
                transactions = transactions.filter(t => t.userId !== uid);

                // Remove uid from household members array
                const newMembers = householdMembers.filter(m => m !== uid);
                await withTimeout(setDoc(doc(db, 'households', householdCode), { members: newMembers }, { merge: true }));
                householdMembers = newMembers;
                householdMemberCount = newMembers.length || 1;

                // Best-effort: clear the removed user's own household link (may fail due to permissions, that's fine)
                try {
                    await withTimeout(setDoc(doc(db, 'users', uid), { householdCode: null }, { merge: true }));
                } catch (e) { /* ignore - no permission to write another user's doc */ }

                updateHouseCardsVisibility();
                updateUI();
                renderMembersList();
                showToast(`${name} foi removido(a) da casa.`);
            } catch (error) {
                console.error('Erro ao remover integrante:', error);
                showToast(`Erro ao remover: ${error.message}`, 'error');
            }
        }

        // ── Visual (tema claro/escuro) ──
        function applyThemeToDom(mode) {
            document.documentElement.classList.toggle('dark', mode === 'dark');
            const lightBtn = document.getElementById('themeOptionLight');
            const darkBtn = document.getElementById('themeOptionDark');
            if (lightBtn) lightBtn.classList.toggle('active', mode !== 'dark');
            if (darkBtn) darkBtn.classList.toggle('active', mode === 'dark');
            const themeColorMeta = document.querySelector('meta[name="theme-color"]');
            if (themeColorMeta) themeColorMeta.setAttribute('content', mode === 'dark' ? '#09090b' : '#F3F4F6');
        }

        function openThemeModal() {
            document.getElementById('themeModal').style.display = 'block';
            applyThemeToDom(isDarkMode() ? 'dark' : 'light');
        }
        function closeThemeModal() {
            document.getElementById('themeModal').style.display = 'none';
        }

        async function setTheme(mode) {
            applyThemeToDom(mode);
            try { localStorage.setItem('fincontrol_theme', mode); } catch (e) {}

            // Re-render charts so Chart.js picks up the new colors
            if (typeof renderChart === 'function') renderChart();

            // Persist to the user's profile so it follows them across devices
            if (currentUser) {
                try {
                    await withTimeout(setDoc(doc(db, 'users', currentUser.uid), { theme: mode }, { merge: true }));
                } catch (e) { /* non-critical */ }
            }
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

        // ── Metas de economia ──
        async function saveSavingsGoal(goal) {
            if (!currentUser || !householdCode) throw new Error('Usuário ou casa não configurados');
            const { id, ...data } = goal;
            await withTimeout(setDoc(doc(db, 'households', householdCode, 'savingsGoals', String(id)), data));
        }

        async function deleteSavingsGoalFromFirestore(id) {
            if (!currentUser || !householdCode) return;
            await withTimeout(fsDeleteDoc(doc(db, 'households', householdCode, 'savingsGoals', String(id))));
        }

        async function saveSavingsInstallment(inst) {
            if (!currentUser || !householdCode) throw new Error('Usuário ou casa não configurados');
            const { id, ...data } = inst;
            await withTimeout(setDoc(doc(db, 'households', householdCode, 'savingsInstallments', String(id)), data));
        }

        async function deleteSavingsInstallmentFromFirestore(id) {
            if (!currentUser || !householdCode) return;
            await withTimeout(fsDeleteDoc(doc(db, 'households', householdCode, 'savingsInstallments', String(id))));
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

        // Todas as transações do mês (SEM excluir as "não pagas"), usada só no
        // Histórico, que precisa mostrar as 3 seções: Pendente / Pagas / Não pagas.
        // Os cálculos do dashboard continuam usando getFilteredTransactions().
        // Também injeta as parcelas de metas de economia do usuário atual como
        // itens de despesa "sintéticos" (dinheiro guardado = dinheiro reservado).
        function getMonthHistoryTransactions() {
            const real = transactions.filter(t => t.date.startsWith(currentMonth));
            return real.concat(getSavingsAsHistoryItems(currentMonth));
        }

        // Valor "efetivo" de uma parcela de meta pro cálculo de despesas/histórico:
        // - pendente ou guardada: conta o valor cheio (já é considerado reservado)
        // - parcial: conta só o que foi realmente guardado
        // - não guardada: não conta nada esse mês (o valor foi todo empurrado pro próximo)
        function getEffectiveSavingsAmount(inst) {
            if (inst.status === 'partial') return inst.savedAmount || 0;
            if (inst.status === 'not_saved') return 0;
            return inst.amount; // 'pending' ou 'saved'
        }

        function getUserMonthSavingsInstallments(monthStr, uid) {
            return savingsInstallments.filter(i => i.month === monthStr && i.userId === uid);
        }

        function getUserMonthSavingsTotal(monthStr, uid, excludeInstId = null) {
            return getUserMonthSavingsInstallments(monthStr, uid)
                .filter(i => i.id !== excludeInstId)
                .reduce((s, i) => s + getEffectiveSavingsAmount(i), 0);
        }

        // Converte as parcelas de metas do usuário atual, no mês informado, em
        // itens no formato de transação (pra reaproveitar toda a renderização do
        // Histórico: seções Pendente/Pagas/Não pagas, agrupamento por categoria etc).
        function getSavingsAsHistoryItems(monthStr) {
            const uid = currentUser?.uid;
            if (!uid) return [];
            return getUserMonthSavingsInstallments(monthStr, uid).map(inst => {
                const goal = savingsGoals.find(g => g.id === inst.goalId);
                return {
                    id: `sav_${inst.id}`,
                    type: 'expense',
                    amount: getEffectiveSavingsAmount(inst),
                    category: 'Guardar Dinheiro',
                    date: `${monthStr}-01`,
                    description: goal ? goal.title : 'Meta de economia',
                    userId: inst.userId,
                    userName: getMyDisplayName(),
                    isAnonymous: false,
                    isSavingsInstallment: true,
                    savingsInstId: inst.id,
                    savingsStatus: inst.status,
                    savingsFullAmount: inst.amount,
                    savingsSavedAmount: inst.savedAmount,
                    savingsPushedFromMonth: inst.pushedFromMonth
                };
            });
        }

        // Saldo disponível do usuário nesse mês, EXCLUINDO uma parcela de meta
        // específica (usado pra avaliar se dá pra guardar aquela parcela ou não).
        function getDisposableForInstallment(inst) {
            const uid = inst.userId;
            const monthTx = transactions.filter(t => t.date.startsWith(inst.month) && isVisibleMonthlyTransaction(t) && t.userId === uid);
            const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            const regularExpense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
            const otherSavings = getUserMonthSavingsTotal(inst.month, uid, inst.id);
            return Math.round((income - regularExpense - otherSavings) * 100) / 100;
        }

        // Aviso de saldo pra uma parcela pendente/acionável: informa se sobra
        // dinheiro suficiente esse mês, se só dá pra guardar uma parte, ou se o
        // saldo está negativo (sem sobra nenhuma).
        function renderSavingsBalanceHintHtml(inst) {
            const disposable = getDisposableForInstallment(inst);
            if (disposable >= inst.amount) {
                return `<div class="savings-balance-hint positive"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>Saldo positivo: sobram ${formatCurrency(disposable)} esse mês — dá pra guardar a parcela inteira</div>`;
            } else if (disposable > 0) {
                return `<div class="savings-balance-hint warning"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path></svg>Saldo insuficiente pro valor total — você tem ${formatCurrency(disposable)} disponível esse mês. Considere guardar um valor parcial.</div>`;
            } else {
                return `<div class="savings-balance-hint negative"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>Saldo negativo esse mês — sem sobra pra guardar essa parcela agora</div>`;
            }
        }

        // Classifica uma despesa em 'pending' | 'paid' | 'unpaid'. Receitas retornam null
        // (não têm conceito de pago/não pago). Transações antigas sem paymentStatus
        // definido são tratadas como pendentes por padrão. Parcelas de metas de
        // economia usam seu próprio status de 4 estados, mapeado pros 3 baldes.
        function getPaymentBucket(t) {
            if (t.type !== 'expense') return null;
            if (t.isSavingsInstallment) {
                if (t.savingsStatus === 'saved' || t.savingsStatus === 'partial') return 'paid';
                if (t.savingsStatus === 'not_saved') return 'unpaid';
                return 'pending';
            }
            if (t.paymentStatus === 'paid') return 'paid';
            if (t.paymentStatus === 'unpaid') return 'unpaid';
            return 'pending';
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
            // Parcelas de metas de economia entram como despesa: esse dinheiro já
            // está reservado, então funciona como se tivesse sido gasto no mês.
            const userSavingsTotal = uid ? getUserMonthSavingsTotal(currentMonth, uid) : 0;
            const userExpense = userTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) + userSavingsTotal;

            document.getElementById('houseIncome').textContent = formatCurrency(houseIncome);
            document.getElementById('houseExpense').textContent = formatCurrency(houseExpense);
            document.getElementById('userIncome').textContent = formatCurrency(userIncome);
            document.getElementById('userExpense').textContent = formatCurrency(userExpense);

            // Box: Minha Diferença (mês atual), com sinal positivo/negativo e badge de status
            const userBalance = userIncome - userExpense;
            renderDifferenceBox('userBalance', 'balanceStatus', userBalance);

            // Box: Diferença da Casa (mês atual), com sinal positivo/negativo e badge de status
            const houseDifference = houseIncome - houseExpense;
            renderDifferenceBox('houseDifference', 'houseDifferenceStatus', houseDifference);

            // Boxes: Comparação em % com o mês passado (Minha e da Casa)
            renderMonthComparison('user', userIncome, userExpense, uid, true);
            renderMonthComparison('house', houseIncome, houseExpense, uid, false);
        }

        // Formata o valor de uma diferença/saldo com cor e badge de status (Sobrando/No negativo/Equilibrado)
        function renderDifferenceBox(valueElId, statusElId, value) {
            const el = document.getElementById(valueElId);
            const statusEl = document.getElementById(statusElId);
            if (!el) return;
            el.textContent = formatCurrency(value);
            if (value > 0) {
                el.className = 'font-display text-lg sm:text-2xl font-semibold text-primary break-all';
                if (statusEl) {
                    statusEl.textContent = 'Sobrando';
                    statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20';
                }
            } else if (value < 0) {
                el.className = 'font-display text-lg sm:text-2xl font-semibold text-danger break-all';
                if (statusEl) {
                    statusEl.textContent = 'No negativo';
                    statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-danger/10 text-danger border border-danger/20';
                }
            } else {
                el.className = 'font-display text-lg sm:text-2xl font-semibold text-zinc-900 dark:text-zinc-50 break-all';
                if (statusEl) {
                    statusEl.textContent = 'Equilibrado';
                    statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-zinc-900/5 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border border-zinc-900/10 dark:border-white/10';
                }
            }
        }

        // Calcula o mês anterior a partir de currentMonth ("YYYY-MM")
        function getPreviousMonthStr(monthStr) {
            const [y, m] = monthStr.split('-').map(Number);
            const d = new Date(y, m - 2, 1); // m é 1-indexado; m-2 -> mês anterior (0-indexado)
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        }

        // Calcula o mês seguinte a partir de um "YYYY-MM"
        function getNextMonthStr(monthStr) {
            const [y, m] = monthStr.split('-').map(Number);
            const d = new Date(y, m, 1); // m já é o índice do próximo mês (1-indexado = mês seguinte 0-indexado)
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        }

        function addMonthsToStr(monthStr, count) {
            let m = monthStr;
            for (let i = 0; i < count; i++) m = getNextMonthStr(m);
            return m;
        }

        // Compara o saldo (Receita - Despesa) do mês atual com o mês anterior.
        // prefix: 'user' ou 'house' -> define quais elementos do DOM são atualizados.
        // onlyUser: true filtra só as transações do usuário atual; false inclui a casa toda (exceto anônimas de outros).
        function renderMonthComparison(prefix, currentIncome, currentExpense, uid, onlyUser) {
            const percentEl = document.getElementById(prefix + 'MonthComparisonPercent');
            const statusEl = document.getElementById(prefix + 'MonthComparisonStatus');
            if (!percentEl || !statusEl) return;

            const prevMonth = getPreviousMonthStr(currentMonth);
            let prevFiltered = transactions.filter(t => t.date.startsWith(prevMonth) && isVisibleMonthlyTransaction(t));
            if (onlyUser) {
                prevFiltered = prevFiltered.filter(t => t.userId === uid);
            } else {
                prevFiltered = prevFiltered.filter(t => {
                    if (t.userId === uid) return true;
                    if (t.isAnonymous) return false;
                    return true;
                });
            }
            const prevIncome = prevFiltered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            const prevExpense = prevFiltered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
            const prevBalance = prevIncome - prevExpense;
            const currentBalance = currentIncome - currentExpense;

            if (prevFiltered.length === 0) {
                percentEl.textContent = '—';
                percentEl.className = 'font-display text-lg sm:text-2xl font-semibold break-all text-zinc-900 dark:text-zinc-50';
                statusEl.textContent = 'Sem dados';
                statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-zinc-900/5 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border border-zinc-900/10 dark:border-white/10';
                return;
            }

            let percentChange;
            if (prevBalance === 0) {
                percentChange = currentBalance === 0 ? 0 : (currentBalance > 0 ? 100 : -100);
            } else {
                percentChange = ((currentBalance - prevBalance) / Math.abs(prevBalance)) * 100;
            }

            const sign = percentChange > 0 ? '+' : '';
            percentEl.textContent = sign + percentChange.toFixed(1).replace('.', ',') + '%';

            if (percentChange > 0) {
                percentEl.className = 'font-display text-lg sm:text-2xl font-semibold break-all text-primary';
                statusEl.textContent = 'Melhorou';
                statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20';
            } else if (percentChange < 0) {
                percentEl.className = 'font-display text-lg sm:text-2xl font-semibold break-all text-danger';
                statusEl.textContent = 'Piorou';
                statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-danger/10 text-danger border border-danger/20';
            } else {
                percentEl.className = 'font-display text-lg sm:text-2xl font-semibold break-all text-zinc-900 dark:text-zinc-50';
                statusEl.textContent = 'Estável';
                statusEl.className = 'text-xs font-medium px-2 py-1 rounded-lg bg-zinc-900/5 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border border-zinc-900/10 dark:border-white/10';
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

            // Usa TODAS as transações do mês (inclusive as "não pagas"), pois o
            // histórico agora precisa exibir as 3 seções de status.
            const monthFiltered = getMonthHistoryTransactions();

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
            const sortVal = document.getElementById('filterSort')?.value || 'amount-desc';
            const sortFn = (a, b) => {
                if (sortVal === 'amount-desc') return b.amount - a.amount;
                if (sortVal === 'amount-asc') return a.amount - b.amount;
                if (sortVal === 'date-asc') return new Date(a.date) - new Date(b.date);
                return new Date(b.date) - new Date(a.date);
            };

            // Separa despesas em 3 seções por status de pagamento; receitas ficam
            // numa lista única (sem seção especial), como já era antes.
            const pendingItems = filtered.filter(t => getPaymentBucket(t) === 'pending').sort(sortFn);
            const paidItems = filtered.filter(t => getPaymentBucket(t) === 'paid').sort(sortFn);
            const unpaidItems = filtered.filter(t => getPaymentBucket(t) === 'unpaid').sort(sortFn);
            const incomeItems = filtered.filter(t => t.type === 'income').sort(sortFn);

            // Ícones neutros por seção (o "peso" de cor fica só no chip do ícone,
            // o rótulo permanece em texto neutro para uma leitura mais sóbria).
            const ICON_PENDING = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>';
            const ICON_PAID = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>';
            const ICON_UNPAID = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path>';

            appendHistorySection(pendingItems, 'Pendente', ICON_PENDING, '--c-warning', tbodyFrag, mobileFrag);
            appendHistorySection(paidItems, 'Contas pagas desse mês', ICON_PAID, '--c-primary', tbodyFrag, mobileFrag);
            appendHistorySection(unpaidItems, 'Contas não pagas', ICON_UNPAID, '--c-danger', tbodyFrag, mobileFrag);
            appendCategoryGroupedRows(incomeItems, tbodyFrag, mobileFrag);

            tbody.appendChild(tbodyFrag);
            mobileList.appendChild(mobileFrag);
        }

        // Renderiza uma seção com cabeçalho (Pendente / Pagas / Não pagas) seguida
        // dos itens agrupados por categoria. Não renderiza nada se a lista estiver vazia.
        function appendHistorySection(items, label, iconSvg, colorVar, tbodyFrag, mobileFrag) {
            if (!items.length) return;
            const total = items.reduce((s, t) => s + t.amount, 0);
            const headerHtml = `
                <div class="history-section-header">
                    <span class="icon-badge" style="background:rgb(var(${colorVar}) / .14); color:rgb(var(${colorVar}))">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:13px;height:13px">${iconSvg}</svg>
                    </span>
                    <span class="label">${label}</span>
                    <span class="count-badge">${items.length}</span>
                    <span class="meta">${formatCurrency(total)}</span>
                </div>`;

            const headerTr = document.createElement('tr');
            headerTr.innerHTML = `<td colspan="6">${headerHtml}</td>`;
            tbodyFrag.appendChild(headerTr);

            const headerDiv = document.createElement('div');
            headerDiv.innerHTML = headerHtml;
            mobileFrag.appendChild(headerDiv.firstElementChild);

            appendCategoryGroupedRows(items, tbodyFrag, mobileFrag);
        }

        // Agrupa uma lista de transações por categoria e monta as linhas (desktop)
        // e os cards (mobile) do histórico.
        function appendCategoryGroupedRows(items, tbodyFrag, mobileFrag) {
            if (!items.length) return;

            const catOrder = [];
            const catMap = {};
            items.forEach(t => {
                if (!catMap[t.category]) { catMap[t.category] = []; catOrder.push(t.category); }
                catMap[t.category].push(t);
            });

            catOrder.forEach(category => {
                const catItems = catMap[category];
                const hasGroup = catItems.length > 1;
                const categoryColor = getCategoryColor(category);
                const groupColor = hexToRgba(categoryColor, 0.35);
                const catTotal = catItems.reduce((s, t) => s + t.amount, 0);

                if (hasGroup) {
                    // Desktop: category header row
                    const headerTr = document.createElement('tr');
                    headerTr.className = 'cat-group-header';
                    headerTr.style.setProperty('--group-color', groupColor);
                    headerTr.style.background = `linear-gradient(90deg, ${hexToRgba(categoryColor, 0.16)}, ${hexToRgba(categoryColor, 0.04)})`;
                    headerTr.innerHTML = `<td colspan="6">
                        <div class="flex items-center justify-between">
                            ${categoryLabelHtml(category)}
                            <span class="text-[11px] text-zinc-500 dark:text-zinc-400 font-normal">${catItems.length} transações · ${formatCurrency(catTotal)}</span>
                        </div>
                    </td>`;
                    tbodyFrag.appendChild(headerTr);
                }

                // Mobile: para categorias com mais de 1 item, tudo fica dentro de uma
                // única caixa (cat-group-box) com o cabeçalho por cima e os itens
                // empilhados dentro, deixando claro que pertencem ao mesmo grupo.
                let groupBox = null;
                if (hasGroup) {
                    groupBox = document.createElement('div');
                    groupBox.className = 'cat-group-box';
                    groupBox.style.setProperty('--group-color', groupColor);

                    const catHeader = document.createElement('div');
                    catHeader.className = 'cat-group-card-header';
                    catHeader.style.background = `linear-gradient(90deg, ${hexToRgba(categoryColor, 0.16)}, ${hexToRgba(categoryColor, 0.04)})`;
                    catHeader.innerHTML = `<div class="flex items-center justify-between">
                        ${categoryLabelHtml(category)}
                        <span class="text-[11px] text-zinc-500 dark:text-zinc-400 font-normal">${catItems.length} transações · ${formatCurrency(catTotal)}</span>
                    </div>`;
                    groupBox.appendChild(catHeader);
                    mobileFrag.appendChild(groupBox);
                }

                catItems.forEach((t, idx) => {
                    const isLastInGroup = hasGroup && idx === catItems.length - 1;
                    const isIncome = t.type === 'income';
                    const userName = t.userName || 'Desconhecido';
                    const isCurrentUser = t.userId === currentUser?.uid;
                    const userBadgeClass = isCurrentUser ? 'bg-accent/20 text-accent border-accent/30' : 'bg-primary/20 text-primary border-primary/30';
                    const groupInfo = t.groupId && t.totalInstallments > 1
                        ? `<span class="text-[9px] text-zinc-600 dark:text-zinc-300 ml-1">Parcela ${t.installmentNum||'?'}/${t.totalInstallments||'?'}</span>`
                        : '';
                    const desc = t.description || t.category;
                    const cleanDesc = hasGroup ? desc : desc;
                    const safeDesc = escapeHtml(cleanDesc);
                    const safeUserName = escapeHtml(userName);
                    const accentColor = getTransactionAccentColor(t);
                    const bucket = getPaymentBucket(t);
                    const isSavings = !!t.isSavingsInstallment;

                    let statusPill;
                    if (isSavings) {
                        statusPill = t.savingsStatus === 'saved' ? '<span class="debt-status-pill paid">Guardado</span>'
                            : t.savingsStatus === 'partial' ? '<span class="debt-status-pill partial">Parcial</span>'
                            : t.savingsStatus === 'not_saved' ? '<span class="debt-status-pill unpaid">Não guardado</span>'
                            : '<span class="debt-status-pill pending">Pendente</span>';
                    } else {
                        statusPill = bucket === 'paid'
                            ? '<span class="debt-status-pill paid">Pago</span>'
                            : bucket === 'unpaid'
                                ? '<span class="debt-status-pill unpaid">Não pago</span>'
                                : bucket === 'pending'
                                    ? '<span class="debt-status-pill pending">Pendente</span>'
                                    : '';
                    }

                    // Aviso quando a pendência veio de uma dívida não paga no mês anterior
                    const lateNote = (!isSavings && bucket === 'pending' && t.createdFromUnpaidDebt)
                        ? `<div class="unpaid-last-month-note"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m0 3.75h.007v.008H12v-.008zM10.29 3.86l-8.18 14.18A1.5 1.5 0 003.42 20.4h17.16a1.5 1.5 0 001.31-2.36L13.71 3.86a1.5 1.5 0 00-2.42 0z"></path></svg>Dívida não paga no mês anterior</div>`
                        : '';

                    // Notas específicas de parcelas de meta de economia
                    const savingsPushedNote = (isSavings && t.savingsPushedFromMonth)
                        ? `<div class="unpaid-last-month-note"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m0 3.75h.007v.008H12v-.008zM10.29 3.86l-8.18 14.18A1.5 1.5 0 003.42 20.4h17.16a1.5 1.5 0 001.31-2.36L13.71 3.86a1.5 1.5 0 00-2.42 0z"></path></svg>Empurrada de ${formatMonthLabel(t.savingsPushedFromMonth)}</div>`
                        : '';
                    const savingsPartialNote = (isSavings && t.savingsStatus === 'partial')
                        ? `<div class="unpaid-last-month-note partial-note"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>Guardou ${formatCurrency(t.savingsSavedAmount)} de ${formatCurrency(t.savingsFullAmount)} — diferença ajustada nas próximas parcelas</div>`
                        : '';
                    const savingsBalanceNote = (isSavings && t.savingsStatus === 'pending')
                        ? renderSavingsBalanceHintHtml(savingsInstallments.find(i => i.id === t.savingsInstId) || { id: t.savingsInstId, month: currentMonth, userId: t.userId, amount: t.savingsFullAmount })
                        : '';
                    const savingsNotes = savingsPushedNote + savingsPartialNote + savingsBalanceNote;

                    const debtButtons = isSavings
                        ? (t.savingsStatus === 'pending' ? `
                            <span class="debt-status-actions">
                                <button onclick="markSavingsInstallment(${t.savingsInstId}, 'saved')" class="debt-status-btn paid" title="Marcar como guardado">Guardei</button>
                                <button onclick="openPartialSaveModal(${t.savingsInstId})" class="debt-status-btn partial" title="Guardei só uma parte">Parcial</button>
                                <button onclick="markSavingsInstallment(${t.savingsInstId}, 'not_saved')" class="debt-status-btn unpaid" title="Marcar como não guardado">Não guardei</button>
                            </span>` : '')
                        : (!isIncome ? `
                            <span class="debt-status-actions">
                                <button onclick="markDebtStatus(${t.id}, 'paid')" class="debt-status-btn paid ${bucket === 'paid' ? 'active' : ''}" title="Marcar como pago">Pago</button>
                                <button onclick="markDebtStatus(${t.id}, 'unpaid')" class="debt-status-btn unpaid ${bucket === 'unpaid' ? 'active' : ''}" title="Marcar como não pago">Não pago</button>
                            </span>` : '');

                    // Ícones de editar/excluir não se aplicam a parcelas de meta (elas são
                    // geridas na aba "Guardar Dinheiro"); mostramos um atalho pra lá.
                    const rowActionIcons = isSavings
                        ? `<button onclick="switchView('goals')" class="text-zinc-500 dark:text-zinc-400 hover:text-accent transition-colors opacity-0 group-hover:opacity-100" title="Ver meta"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></button>`
                        : `<button onclick="editTransaction(${t.id})" class="text-zinc-500 dark:text-zinc-400 hover:text-accent transition-colors opacity-0 group-hover:opacity-100" title="Editar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                            <button onclick="deleteTransaction(${t.id})" class="text-zinc-500 dark:text-zinc-400 hover:text-danger transition-colors opacity-0 group-hover:opacity-100" title="Excluir"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>`;
                    const rowActionIconsMobile = isSavings
                        ? `<button onclick="switchView('goals')" class="text-zinc-500 dark:text-zinc-400 hover:text-accent transition-colors p-1" title="Ver meta"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></button>`
                        : `<button onclick="editTransaction(${t.id})" class="text-zinc-500 dark:text-zinc-400 hover:text-accent transition-colors p-1" title="Editar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                            <button onclick="deleteTransaction(${t.id})" class="text-zinc-500 dark:text-zinc-400 hover:text-danger transition-colors p-1" title="Excluir"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>`;

                    // Desktop table row
                    const tr = document.createElement('tr');
                    tr.className = `group history-row hover:brightness-95 dark:hover:brightness-110 transition-colors${hasGroup ? ' cat-sub-row' : ''}${isLastInGroup ? ' cat-group-last' : ''}`;
                    tr.style.background = `linear-gradient(90deg, ${hexToRgba(accentColor, 0.16)}, ${hexToRgba(accentColor, 0.035)})`;
                    if (hasGroup) {
                        tr.style.setProperty('--group-color', groupColor);
                    } else {
                        tr.style.borderLeft = `2px solid ${hexToRgba(accentColor, 0.55)}`;
                    }
                    tr.innerHTML = `
                        <td class="py-3.5"><div class="font-medium text-zinc-800 dark:text-zinc-100">${safeDesc}${groupInfo} ${statusPill}</div>${!hasGroup && t.description && t.description !== t.category ? `<div class="mt-1">${categoryLabelHtml(t.category, 'text-xs')}</div>` : ''}${lateNote}${savingsNotes}</td>
                        ${hasGroup ? `<td class="py-3.5 cat-sub-date">${formatDate(t.date)}</td>` : `<td class="py-3.5">${categoryPillHtml(t.category)}</td>`}
                        <td class="py-3.5"><span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${userBadgeClass} border">${safeUserName}</span></td>
                        ${hasGroup ? `<td class="py-3.5"></td>` : `<td class="py-3.5 text-zinc-500 dark:text-zinc-400 hidden md:table-cell">${formatDate(t.date)}</td>`}
                        <td class="py-3.5 text-right font-semibold ${isIncome?'text-primary':'text-danger'}">${isIncome?'+':'-'} ${formatCurrency(t.amount)}</td>
                        <td class="py-3.5 text-center"><div class="flex items-center justify-center gap-2 flex-wrap">
                            ${debtButtons}
                            ${rowActionIcons}
                        </div></td>`;
                    tbodyFrag.appendChild(tr);

                    if (hasGroup) {
                        // Mobile: linha simples DENTRO da caixa do grupo (sem borda/raio
                        // próprios — a caixa já fornece o contorno externo do grupo).
                        const row = document.createElement('div');
                        row.className = `cat-item-row${isLastInGroup ? ' cat-item-row-last' : ''}`;
                        row.style.background = `linear-gradient(90deg, ${hexToRgba(accentColor, 0.14)}, ${hexToRgba(accentColor, 0.03)})`;
                        row.innerHTML = `
                            <div class="flex items-start justify-between mb-2.5">
                                <div class="flex-1 min-w-0">
                                    <p class="font-medium text-zinc-800 dark:text-zinc-100 text-sm truncate">${safeDesc}${groupInfo} ${statusPill}</p>
                                    ${lateNote}${savingsNotes}
                                </div>
                                <span class="font-semibold text-sm ${isIncome?'text-primary':'text-danger'} ml-3 whitespace-nowrap">${isIncome?'+':'-'} ${formatCurrency(t.amount)}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${userBadgeClass} border">${safeUserName}</span>
                                    <span class="text-[10px] text-zinc-500 dark:text-zinc-400">${formatDate(t.date)}</span>
                                </div>
                                <div class="flex items-center gap-2 flex-wrap justify-end">
                                    ${debtButtons}
                                    ${rowActionIconsMobile}
                                </div>
                            </div>`;
                        groupBox.appendChild(row);
                    } else {
                        // Mobile: card independente (categoria com um único lançamento)
                        const card = document.createElement('div');
                        card.className = 'history-row border border-zinc-900/8 dark:border-white/5 rounded-xl p-4 hover:brightness-95 dark:hover:brightness-110 transition-colors';
                        card.style.background = `linear-gradient(90deg, ${hexToRgba(accentColor, 0.16)}, ${hexToRgba(accentColor, 0.035)})`;
                        card.style.borderLeft = `2px solid ${hexToRgba(accentColor, 0.55)}`;
                        card.innerHTML = `
                            <div class="flex items-start justify-between mb-3">
                                <div class="flex-1 min-w-0">
                                    <p class="font-medium text-zinc-800 dark:text-zinc-100 text-sm truncate">${safeDesc}${groupInfo} ${statusPill}</p>
                                    ${t.description && t.description !== t.category ? `<div class="mt-1">${categoryLabelHtml(t.category, 'text-xs')}</div>` : ''}
                                    ${lateNote}${savingsNotes}
                                </div>
                                <span class="font-semibold text-sm ${isIncome?'text-primary':'text-danger'} ml-3 whitespace-nowrap">${isIncome?'+':'-'} ${formatCurrency(t.amount)}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2 flex-wrap">
                                    ${categoryPillHtml(t.category)}
                                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${userBadgeClass} border">${safeUserName}</span>
                                    <span class="text-[10px] text-zinc-500 dark:text-zinc-400">${formatDate(t.date)}</span>
                                </div>
                                <div class="flex items-center gap-2 flex-wrap justify-end">
                                    ${debtButtons}
                                    ${rowActionIconsMobile}
                                </div>
                            </div>`;
                        mobileFrag.appendChild(card);
                    }
                });
            });
        }


        function populateUserFilter(transactionsList) {
            const select = document.getElementById('filterUser');
            if (!select) return;

            // Só faz sentido mostrar o filtro de usuário quando a casa tem mais de
            // 1 morador — com um usuário só, filtrar por usuário é redundante.
            if (householdMemberCount <= 1) {
                select.style.display = 'none';
                select.value = 'all';
                return;
            }
            select.style.display = '';

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
            if (sortEl) sortEl.value = 'amount-desc';
            if (userEl) userEl.value = 'all';
            if (typeEl) typeEl.value = 'expense';
            try { localStorage.setItem('fincontrol_filterType', 'expense'); } catch (e) {}
            updateUI();
        }

        function setChartFilter(filter) {
            chartFilter = filter;
            document.getElementById('chartFilterAll').classList.toggle('active', filter === 'all');
            document.getElementById('chartFilterUser').classList.toggle('active', filter === 'user');
            renderChart();
        }

        function onChartViewModeChange() {
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
            } else { // 'year'
                const year = new Date().getFullYear();
                filtered = transactions.filter(t => {
                    const txDate = new Date(t.date);
                    return txDate.getFullYear() === year;
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

        // Gráfico único: despesas em barras empilhadas por categoria (mostra a
        // composição) + receita como linha sobreposta (mostra a evolução) —
        // tudo junto, sem precisar de dois gráficos separados.
        // Gráfico único: uma linha por categoria de despesa, mostrando a evolução
        // de cada categoria ao longo do tempo. Sem receita/despesa total — só as
        // categorias.
        function renderCombinedChart(ctx) {
            const viewMode = document.getElementById('chartViewMode').value;
            const filtered = getChartTransactions();

            let labels = [];
            let groupingFn;

            if (viewMode === 'month') {
                const now = new Date();
                const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
                groupingFn = (t) => new Date(t.date).getDate() - 1;
            } else { // 'year'
                labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                groupingFn = (t) => new Date(t.date).getMonth();
            }

            const categoryBuckets = {};
            filtered.forEach(t => {
                if (t.type !== 'expense') return;
                const bucket = groupingFn(t);
                if (bucket < 0 || bucket >= labels.length) return;
                if (!categoryBuckets[t.category]) categoryBuckets[t.category] = Array.from({ length: labels.length }, () => 0);
                categoryBuckets[t.category][bucket] += t.amount;
            });

            if (Object.keys(categoryBuckets).length === 0) return;

            // Categorias ordenadas da maior pra menor
            const sortedEntries = Object.entries(categoryBuckets).sort((a, b) => {
                const totalA = a[1].reduce((s, v) => s + v, 0);
                const totalB = b[1].reduce((s, v) => s + v, 0);
                return totalB - totalA;
            });

            const datasets = sortedEntries.map(([category, values]) => {
                const color = getCategoryColor(category);
                return {
                    label: category,
                    data: values,
                    borderColor: color,
                    backgroundColor: hexToRgba(color, 0.1),
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false,
                    pointBackgroundColor: color,
                    pointBorderColor: color,
                    pointRadius: 3,
                    pointHoverRadius: 5
                };
            });

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
                                color: chartLegendColor(),
                                font: { family: 'Plus Jakarta Sans', size: 11 },
                                padding: 14,
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
                            grid: { color: chartGridColor(), drawBorder: false },
                            ticks: { color: chartTickColor(), font: { family: 'Plus Jakarta Sans', size: 11 } }
                        },
                        y: {
                            grid: { color: chartGridColor(), drawBorder: false },
                            ticks: {
                                color: chartTickColor(),
                                font: { family: 'Plus Jakarta Sans', size: 11 },
                                callback: function(value) { return formatCurrency(value); }
                            },
                            beginAtZero: true
                        }
                    }
                }
            });
        }

        function safeDestroyChart() {
            const canvas = document.getElementById('expenseChart');
            if (canvas) {
                const existing = Chart.getChart(canvas);
                if (existing) existing.destroy();
                const ctx2 = canvas.getContext('2d');
                ctx2.clearRect(0, 0, canvas.width, canvas.height);
            }
            expenseChartInstance = null;
        }

        function renderChart() {
            safeDestroyChart();
            const ctx = document.getElementById('expenseChart').getContext('2d');
            renderCombinedChart(ctx);
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
                        // A parcela que estava sendo editada (i===0) mantém seu status de
                        // pagamento anterior (ex: se já estava paga, continua paga).
                        // Parcelas novas criadas por causa da edição começam pendentes.
                        const preservedStatus = (i === 0 && currentTx.paymentStatus) ? currentTx.paymentStatus : null;
                        const paymentStatus = fd.get('type') === 'expense'
                            ? (preservedStatus || 'pending')
                            : undefined;
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
                        if (paymentStatus) t.paymentStatus = paymentStatus;
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
                        if (fd.get('type') === 'expense') t.paymentStatus = 'pending';
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

        // ══════════════════════════════════════════════════════════
        // METAS DE ECONOMIA ("Guardar Dinheiro")
        // ══════════════════════════════════════════════════════════
        // Cada usuário tem suas próprias metas. Uma meta tem N parcelas mensais
        // fixas (geradas todas de uma vez na criação). Ao marcar uma parcela como
        // "Não guardei", ela é empurrada um mês pra frente, adiando o fim da meta.

        function switchView(view) {
            currentView = view;
            const dashboardView = document.getElementById('dashboardView');
            const goalsView = document.getElementById('goalsView');
            const tabDashboard = document.getElementById('viewTabDashboard');
            const tabGoals = document.getElementById('viewTabGoals');
            if (view === 'goals') {
                dashboardView.classList.add('hidden');
                goalsView.classList.remove('hidden');
                tabDashboard.classList.remove('view-tab-active');
                tabGoals.classList.add('view-tab-active');
                renderGoalsView();
                updateUI();
            } else {
                dashboardView.classList.remove('hidden');
                goalsView.classList.add('hidden');
                tabGoals.classList.remove('view-tab-active');
                tabDashboard.classList.add('view-tab-active');
            }
        }

        function getUserSavingsGoals() {
            const uid = currentUser?.uid;
            return savingsGoals.filter(g => g.userId === uid).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        }

        function getGoalInstallments(goalId) {
            return savingsInstallments
                .filter(i => i.goalId === goalId)
                .sort((a, b) => a.installmentNum - b.installmentNum);
        }

        function getGoalProgress(goalId) {
            const goal = savingsGoals.find(g => g.id === goalId);
            const items = getGoalInstallments(goalId);
            let savedAmount = 0;
            items.forEach(i => {
                if (i.status === 'saved') savedAmount += i.amount;
                else if (i.status === 'partial') savedAmount += (i.savedAmount || 0);
            });
            savedAmount = Math.round(savedAmount * 100) / 100;
            // O total é o valor FIXO da meta (definido na criação), não a soma das
            // parcelas atuais — isso porque parcelas futuras podem ser ajustadas
            // pra cima quando uma parcela anterior é paga parcialmente.
            const totalAmount = goal ? goal.totalAmount : items.reduce((s, i) => s + i.amount, 0);
            const pct = totalAmount > 0 ? (savedAmount / totalAmount) * 100 : 0;
            const savedCount = items.filter(i => i.status === 'saved').length;
            return { savedAmount, totalAmount, pct, savedCount, totalCount: items.length };
        }

        // ── Modal de criação ──
        function openGoalModal() {
            document.getElementById('goalForm').reset();
            setSavingsInputMode('total');
            document.getElementById('goalModal').style.display = 'block';
            updateGoalPreview();
        }
        function closeGoalModal() {
            document.getElementById('goalModal').style.display = 'none';
        }

        function setSavingsInputMode(mode) {
            savingsInputMode = mode;
            const isTotal = mode === 'total';
            document.getElementById('goalModeTotalBtn').classList.toggle('goal-mode-active', isTotal);
            document.getElementById('goalModeInstallmentBtn').classList.toggle('goal-mode-active', !isTotal);
            document.getElementById('goalTotalAmountField').classList.toggle('hidden', !isTotal);
            document.getElementById('goalInstallmentAmountField').classList.toggle('hidden', isTotal);
            updateGoalPreview();
        }

        function updateGoalPreview() {
            const installments = parseInt(document.getElementById('goalInstallments').value, 10) || 0;
            const previewEl = document.getElementById('goalPreview');
            if (!installments) { previewEl.textContent = ''; return; }

            if (savingsInputMode === 'total') {
                const total = parseFloat(document.getElementById('goalTotalAmount').value) || 0;
                if (!total) { previewEl.textContent = ''; return; }
                const perInstallment = total / installments;
                previewEl.textContent = `≈ ${formatCurrency(perInstallment)} por mês, durante ${installments} ${installments === 1 ? 'mês' : 'meses'}`;
            } else {
                const perInstallment = parseFloat(document.getElementById('goalInstallmentAmount').value) || 0;
                if (!perInstallment) { previewEl.textContent = ''; return; }
                const total = perInstallment * installments;
                previewEl.textContent = `Meta final: ${formatCurrency(total)}, em ${installments} ${installments === 1 ? 'mês' : 'meses'}`;
            }
        }

        async function handleGoalSubmit(e) {
            e.preventDefault();
            const fd = new FormData(e.target);
            const title = (fd.get('title') || '').toString().trim();
            const installments = parseInt(fd.get('installments'), 10);

            if (!title) { showToast('Dê um nome pra sua meta', 'error'); return; }
            if (!installments || installments < 1) { showToast('Informe a quantidade de parcelas', 'error'); return; }

            let installmentAmount;
            if (savingsInputMode === 'total') {
                const total = parseFloat(fd.get('totalAmount'));
                if (!total || total <= 0) { showToast('Informe o valor total da meta', 'error'); return; }
                installmentAmount = Math.round((total / installments) * 100) / 100;
            } else {
                installmentAmount = parseFloat(fd.get('installmentAmount'));
                if (!installmentAmount || installmentAmount <= 0) { showToast('Informe o valor da parcela', 'error'); return; }
            }

            const goalId = Date.now();
            const goal = {
                id: goalId,
                userId: currentUser.uid,
                userName: getMyDisplayName(),
                title,
                installmentAmount,
                totalInstallments: installments,
                totalAmount: Math.round(installmentAmount * installments * 100) / 100,
                createdAt: new Date().toISOString(),
                startMonth: currentMonth
            };

            try {
                savingsGoals.push(goal);
                await saveSavingsGoal(goal);

                for (let i = 0; i < installments; i++) {
                    const inst = {
                        id: goalId + 1 + i,
                        goalId: goalId,
                        userId: currentUser.uid,
                        installmentNum: i + 1,
                        amount: installmentAmount,
                        originalAmount: installmentAmount,
                        month: addMonthsToStr(currentMonth, i),
                        status: 'pending'
                    };
                    savingsInstallments.push(inst);
                    await saveSavingsInstallment(inst);
                }

                closeGoalModal();
                renderGoalsView();
                updateUI();
                showToast('Meta criada! Vamos guardar esse dinheiro 💰');
            } catch (error) {
                console.error('Erro ao criar meta:', error);
                showToast(`Erro ao criar meta: ${error.message}`, 'error');
            }
        }

        async function deleteSavingsGoal(goalId) {
            if (!confirm('Excluir esta meta e todas as suas parcelas?')) return;
            try {
                const items = getGoalInstallments(goalId);
                for (const i of items) {
                    savingsInstallments = savingsInstallments.filter(x => x.id !== i.id);
                    await deleteSavingsInstallmentFromFirestore(i.id);
                }
                savingsGoals = savingsGoals.filter(g => g.id !== goalId);
                await deleteSavingsGoalFromFirestore(goalId);
                renderGoalsView();
                updateUI();
                showToast('Meta excluída');
            } catch (error) {
                console.error('Erro ao excluir meta:', error);
                showToast(`Erro ao excluir: ${error.message}`, 'error');
            }
        }

        // Marca uma parcela como guardada ou não guardada.
        // "Não guardei" empurra essa parcela pro mês seguinte (criando uma nova
        // parcela pendente lá), adiando o fim da meta.
        async function markSavingsInstallment(instId, status) {
            const inst = savingsInstallments.find(i => i.id === instId);
            if (!inst) return;

            try {
                if (status === 'saved') {
                    inst.status = 'saved';
                    inst.savedAt = new Date().toISOString();
                    await saveSavingsInstallment(inst);
                } else {
                    inst.status = 'not_saved';
                    await saveSavingsInstallment(inst);

                    // Empurra essa parcela pro mês seguinte (livre, sem colidir
                    // com outra parcela já agendada)
                    let pushedMonth = getNextMonthStr(inst.month);
                    const items = getGoalInstallments(inst.goalId);
                    const occupied = new Set(items.filter(i => i.status !== 'not_saved' && i.id !== inst.id).map(i => i.month));
                    while (occupied.has(pushedMonth)) pushedMonth = getNextMonthStr(pushedMonth);

                    const newInst = {
                        id: Date.now(),
                        goalId: inst.goalId,
                        userId: inst.userId,
                        installmentNum: items.length + 1,
                        amount: inst.amount,
                        originalAmount: inst.originalAmount || inst.amount,
                        month: pushedMonth,
                        status: 'pending',
                        pushedFromMonth: inst.month
                    };
                    savingsInstallments.push(newInst);
                    await saveSavingsInstallment(newInst);
                }
                renderGoalsView();
                updateUI();
            } catch (error) {
                console.error('Erro ao marcar parcela:', error);
                showToast(`Erro: ${error.message}`, 'error');
            }
        }

        // Marca uma parcela como PARCIALMENTE guardada: o usuário informa quanto
        // conseguiu guardar (menos que o valor da parcela). A diferença (déficit)
        // é redistribuída igualmente entre as parcelas PENDENTES seguintes da
        // mesma meta, aumentando o valor delas — assim a meta continua batendo
        // 100% no final, sem precisar adicionar meses extras.
        // Se não sobrar nenhuma parcela pendente pra receber o déficit, cria uma
        // parcela extra no próximo mês livre (mesma lógica do "não guardei").
        async function markSavingsInstallmentPartial(instId, amountSaved) {
            const inst = savingsInstallments.find(i => i.id === instId);
            if (!inst) return;

            amountSaved = Math.round(amountSaved * 100) / 100;
            const deficit = Math.round((inst.amount - amountSaved) * 100) / 100;

            try {
                inst.status = 'partial';
                inst.savedAmount = amountSaved;
                inst.savedAt = new Date().toISOString();
                await saveSavingsInstallment(inst);

                if (deficit > 0) {
                    const items = getGoalInstallments(inst.goalId);
                    const remaining = items.filter(i => i.status === 'pending' && i.id !== inst.id);

                    if (remaining.length > 0) {
                        const share = Math.floor((deficit / remaining.length) * 100) / 100;
                        let allocated = 0;
                        for (let idx = 0; idx < remaining.length; idx++) {
                            const r = remaining[idx];
                            let extra;
                            if (idx === remaining.length - 1) {
                                // a última parcela absorve o resto do arredondamento,
                                // garantindo que a soma bate certinho com o déficit
                                extra = Math.round((deficit - allocated) * 100) / 100;
                            } else {
                                extra = share;
                                allocated = Math.round((allocated + share) * 100) / 100;
                            }
                            r.amount = Math.round((r.amount + extra) * 100) / 100;
                            await saveSavingsInstallment(r);
                        }
                    } else {
                        // Não há mais parcelas pendentes: cria uma parcela extra
                        // só com o valor do déficit, no próximo mês livre.
                        let pushedMonth = getNextMonthStr(inst.month);
                        const occupied = new Set(items.filter(i => i.id !== inst.id).map(i => i.month));
                        while (occupied.has(pushedMonth)) pushedMonth = getNextMonthStr(pushedMonth);

                        const newInst = {
                            id: Date.now(),
                            goalId: inst.goalId,
                            userId: inst.userId,
                            installmentNum: items.length + 1,
                            amount: deficit,
                            originalAmount: deficit,
                            month: pushedMonth,
                            status: 'pending',
                            pushedFromMonth: inst.month
                        };
                        savingsInstallments.push(newInst);
                        await saveSavingsInstallment(newInst);
                    }
                }
                renderGoalsView();
                updateUI();
                showToast('Parcela parcial registrada. Ajustamos os próximos meses pra compensar.');
            } catch (error) {
                console.error('Erro ao registrar parcela parcial:', error);
                showToast(`Erro: ${error.message}`, 'error');
            }
        }

        function openPartialSaveModal(instId) {
            const inst = savingsInstallments.find(i => i.id === instId);
            if (!inst) return;
            document.getElementById('partialSaveInstId').value = instId;
            document.getElementById('partialSaveMax').textContent = formatCurrency(inst.amount);
            const amountInput = document.getElementById('partialSaveAmount');
            amountInput.max = inst.amount;
            amountInput.value = '';
            document.getElementById('partialSaveModal').style.display = 'block';
            setTimeout(() => amountInput.focus(), 50);
        }
        function closePartialSaveModal() {
            document.getElementById('partialSaveModal').style.display = 'none';
        }

        async function handlePartialSaveSubmit(e) {
            e.preventDefault();
            const instId = Number(document.getElementById('partialSaveInstId').value);
            const inst = savingsInstallments.find(i => i.id === instId);
            if (!inst) return;
            let amountSaved = parseFloat(document.getElementById('partialSaveAmount').value);

            if (isNaN(amountSaved) || amountSaved <= 0) { showToast('Informe quanto você conseguiu guardar', 'error'); return; }
            if (amountSaved >= inst.amount) {
                // Guardou o valor cheio (ou mais) — trata como "Guardei" normal
                closePartialSaveModal();
                await markSavingsInstallment(instId, 'saved');
                return;
            }

            closePartialSaveModal();
            await markSavingsInstallmentPartial(instId, amountSaved);
        }

        // ── Renderização da aba "Metas" ──
        function renderGoalsView() {
            const container = document.getElementById('goalsList');
            const emptyState = document.getElementById('goalsEmptyState');
            const goals = getUserSavingsGoals();

            if (!goals.length) {
                container.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }
            emptyState.classList.add('hidden');

            container.innerHTML = goals.map(goal => renderGoalCard(goal)).join('');
        }

        function renderGoalCard(goal) {
            const progress = getGoalProgress(goal.id);
            const items = getGoalInstallments(goal.id);
            const pctDisplay = Math.min(100, progress.pct).toFixed(0);
            const isComplete = progress.savedCount === progress.totalCount && progress.totalCount > 0;

            const installmentsHtml = items.map(item => {
                const isFuture = item.month > currentMonth;
                const monthLabel = formatMonthLabel(item.month);

                let statusHtml;
                if (item.status === 'saved') {
                    statusHtml = '<span class="debt-status-pill paid">Guardei</span>';
                } else if (item.status === 'partial') {
                    statusHtml = '<span class="debt-status-pill partial">Parcial</span>';
                } else if (item.status === 'not_saved') {
                    statusHtml = '<span class="debt-status-pill unpaid">Não guardei</span>';
                } else if (isFuture) {
                    statusHtml = '<span class="debt-status-pill pending">Futura</span>';
                } else {
                    statusHtml = '<span class="debt-status-pill pending">Pendente</span>';
                }

                const canAct = item.status === 'pending' && !isFuture;
                const actionsHtml = canAct ? `
                    <span class="debt-status-actions">
                        <button onclick="markSavingsInstallment(${item.id}, 'saved')" class="debt-status-btn paid" title="Marcar como guardado">Guardei</button>
                        <button onclick="openPartialSaveModal(${item.id})" class="debt-status-btn partial" title="Guardei só uma parte">Parcial</button>
                        <button onclick="markSavingsInstallment(${item.id}, 'not_saved')" class="debt-status-btn unpaid" title="Marcar como não guardado">Não guardei</button>
                    </span>` : '';

                const pushedNote = item.pushedFromMonth
                    ? `<div class="unpaid-last-month-note"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m0 3.75h.007v.008H12v-.008zM10.29 3.86l-8.18 14.18A1.5 1.5 0 003.42 20.4h17.16a1.5 1.5 0 001.31-2.36L13.71 3.86a1.5 1.5 0 00-2.42 0z"></path></svg>Empurrada de ${formatMonthLabel(item.pushedFromMonth)}</div>`
                    : '';

                const partialNote = item.status === 'partial'
                    ? `<div class="unpaid-last-month-note partial-note"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>Guardou ${formatCurrency(item.savedAmount)} de ${formatCurrency(item.amount)} — a diferença foi ajustada nas próximas parcelas</div>`
                    : '';

                const adjustedNote = (item.status === 'pending' && item.originalAmount && item.amount > item.originalAmount)
                    ? `<div class="unpaid-last-month-note adjusted-note"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>Valor ajustado (era ${formatCurrency(item.originalAmount)}) pra compensar uma parcela anterior</div>`
                    : '';

                const balanceNote = canAct ? renderSavingsBalanceHintHtml(item) : '';

                const displayAmount = item.status === 'partial' ? item.savedAmount : item.amount;

                return `
                    <div class="cat-item-row goal-installment-row${isFuture ? ' goal-installment-future' : ''}">
                        <div class="flex items-start justify-between mb-2">
                            <div class="flex-1 min-w-0">
                                <p class="font-medium text-zinc-800 dark:text-zinc-100 text-sm capitalize">${monthLabel} ${statusHtml}</p>
                                ${pushedNote}
                                ${partialNote}
                                ${adjustedNote}
                                ${balanceNote}
                            </div>
                            <span class="font-semibold text-sm text-primary ml-3 whitespace-nowrap">${formatCurrency(displayAmount)}</span>
                        </div>
                        ${actionsHtml ? `<div class="flex justify-end">${actionsHtml}</div>` : ''}
                    </div>`;
            }).join('');

            return `
                <div class="glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6 animate-fade-in relative overflow-hidden">
                    <div class="flex items-start justify-between gap-3 mb-4">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <h3 class="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-50 truncate">${escapeHtml(goal.title)}</h3>
                                ${isComplete ? '<span class="debt-status-pill paid">Concluída 🎉</span>' : ''}
                            </div>
                            <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${formatCurrency(goal.installmentAmount)}/mês · ${goal.totalInstallments} ${goal.totalInstallments === 1 ? 'parcela' : 'parcelas'}</p>
                        </div>
                        <button onclick="deleteSavingsGoal(${goal.id})" class="text-zinc-400 hover:text-danger transition-colors p-1 flex-shrink-0" title="Excluir meta">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>

                    <div class="mb-1 flex items-baseline justify-between gap-2">
                        <span class="font-display text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-zinc-50">${formatCurrency(progress.savedAmount)}</span>
                        <span class="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">de ${formatCurrency(progress.totalAmount)}</span>
                    </div>
                    <div class="goal-progress-track mb-1">
                        <div class="goal-progress-fill" style="width:${Math.min(100, progress.pct)}%"></div>
                    </div>
                    <div class="flex items-center justify-between mb-4">
                        <span class="text-xs font-semibold text-primary">${pctDisplay}% da meta</span>
                        <span class="text-xs text-zinc-500 dark:text-zinc-400">${progress.savedCount}/${progress.totalCount} parcelas guardadas</span>
                    </div>

                    <details class="goal-installments-details">
                        <summary class="text-xs font-semibold text-accent cursor-pointer select-none">Ver parcelas mês a mês</summary>
                        <div class="mt-3 space-y-2">${installmentsHtml}</div>
                    </details>
                </div>`;
        }

        function formatMonthLabel(monthStr) {
            const [y, m] = monthStr.split('-').map(Number);
            const d = new Date(y, m - 1, 1);
            return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
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
                helper.className='text-[11px] text-zinc-500 dark:text-zinc-400 truncate';
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
                removeLogoBtn.className='category-chip-btn category-remove-logo-btn';
                removeLogoBtn.textContent='Remover logo';
                removeLogoBtn.style.display=getCategoryLogo(cat) ? 'inline-flex' : 'none';
                removeLogoBtn.addEventListener('click', ()=>removeCategoryLogo(cat));

                const deleteBtn=document.createElement('button');
                deleteBtn.type='button';
                deleteBtn.className='category-delete-btn';
                deleteBtn.title='Excluir categoria';
                deleteBtn.innerHTML='<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
                deleteBtn.addEventListener('click', ()=>deleteCategory(cat));

                tools.appendChild(colorInput);
                tools.appendChild(uploadBtn);
                tools.appendChild(autoBtn);
                tools.appendChild(deleteBtn);
                tools.appendChild(removeLogoBtn);
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
                    if (data.theme === 'dark' || data.theme === 'light') {
                        applyThemeToDom(data.theme);
                        try { localStorage.setItem('fincontrol_theme', data.theme); } catch (e) {}
                    }
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

        document.addEventListener('keydown',(e)=>{if(e.key==='Escape'){closeModal();closeCategoryModal();closeDebtRolloverModal();closeSettingsModal();closeMembersModal();closeThemeModal();closeProfileModal();}});

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
