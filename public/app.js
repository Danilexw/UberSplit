const CONFIG = {
    URL: "https://tueewgpkotikpyniurlk.supabase.co",
    KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1ZWV3Z3Brb3Rpa3B5bml1cmxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTk1OTQsImV4cCI6MjA5MDczNTU5NH0.CRGDlx3tIokpMEVj4PD2L1H431JdGwvsAahc8XJfghc"
};

const supabaseClient = window.supabase.createClient(CONFIG.URL, CONFIG.KEY);

// --- MÓDULO DE DADOS (API) ---
// --- MÓDULO DE DADOS (API) ---
const api = {
    async getCurrentUser() {
        const { data: { user } } = await supabaseClient.auth.getUser();
        return user;
    },

    async getAmigos() {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('id, nome, email');
        if (error) throw error;
        return data;
    },

    async logout() {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    },

    async getMinhasDividas() {
        const user = await this.getCurrentUser();
        // Simplifiquei a query para evitar erros de relacionamento
        const { data, error } = await supabaseClient
            .from('ride_participants')
            .select(`
                id,
                valor_parcela,
                pago,
                ride_id,
                rides (
                    data_corrida,
                    valor_total,
                    criado_por
                )
            `)
            .eq('user_id', user.id)
            .order('pago', { ascending: true });

        if (error) throw error;
        return data;
    },

    // Versão mais "segura" da função de agrupar
    async getDividasAgrupadas() {
        const user = await this.getCurrentUser();
        const dividas = await this.getMinhasDividas();
        const amigos = await this.getAmigos();

        // Filtra apenas o que não está pago
        const pendentes = dividas.filter(d => !d.pago);

        return pendentes.reduce((acc, item) => {
            const credorId = item.rides.criado_por;
            // Busca o nome do amigo na lista de amigos que já temos
            const infoAmigo = amigos.find(a => a.id === credorId);
            const nomeCredor = infoAmigo ? (infoAmigo.nome || infoAmigo.email.split('@')[0]) : "Outro";
            
            if (!acc[credorId]) {
                acc[credorId] = { nome: nomeCredor, total: 0 };
            }
            acc[credorId].total += parseFloat(item.valor_parcela);
            return acc;
        }, {});
    },

    async createRide(totalValue, idsParticipantes) {
        const user = await this.getCurrentUser();
        const { data: ride, error: rErr } = await supabaseClient
            .from('rides')
            .insert({ criado_por: user.id, valor_total: totalValue })
            .select().single();

        if (rErr) throw rErr;

        const share = totalValue / idsParticipantes.length;
        const participants = idsParticipantes.map(id => ({
            ride_id: ride.id,
            user_id: id,
            valor_parcela: share,
            pago: id === user.id 
        }));

        const { error: iErr } = await supabaseClient.from('ride_participants').insert(participants);
        if (iErr) throw iErr;
    }
};

// --- MÓDULO DE INTERFACE (UI) ---
// --- MÓDULO DE INTERFACE (UI) ---
const ui = {
    async renderDashboard() {
    const user = await api.getCurrentUser();
    if (!user) return;

    // 1. Nome na Navbar
    const infoDiv = document.getElementById('user-info');
    if (infoDiv) infoDiv.innerText = `Olá, ${user.email.split('@')[0]}`;

    // Buscamos os amigos uma única vez para usar como referência de nomes
    const amigos = await api.getAmigos();

    // 2. Checkboxes dos Amigos
    try {
        const containerCheck = document.getElementById('lista-usuarios-checkbox');
        if (containerCheck) {
            containerCheck.innerHTML = amigos.map(amigo => `
                <label class="checkbox-item">
                    <input type="checkbox" class="user-check" value="${amigo.id}" ${amigo.id === user.id ? 'checked disabled' : ''}>
                    ${amigo.nome || amigo.email.split('@')[0]}
                </label>
            `).join('');
        }
    } catch (err) { console.error("Erro amigos:", err); }

    // 3. Renderizar Filtros (Tabs) e Saldo Total
    try {
        const resumo = await api.getDividasAgrupadas();
        const containerTabs = document.getElementById('detalhe-dividas');
        const totalPendenteEl = document.getElementById('total-pendente');
        
        let totalGeral = 0;

        if (containerTabs) {
            const ids = Object.keys(resumo);
            if (ids.length === 0) {
                containerTabs.innerHTML = "<small style='color: #888;'>Nenhuma dívida pendente.</small>";
            } else {
                containerTabs.innerHTML = ids.map(id => {
                    totalGeral += resumo[id].total;
                    return `
                        <div class="user-tab-item" 
                             style="background:#eee; padding:8px 12px; border-radius:12px; cursor:pointer; display:inline-block; margin:5px; border:1px solid #ddd;"
                             onclick="ui.filtrarPorUsuario('${resumo[id].nome}', ${resumo[id].total})">
                            <span style="font-size:10px; display:block; color:#666;">${resumo[id].nome}</span>
                            <strong>R$ ${resumo[id].total.toFixed(2)}</strong>
                        </div>
                    `;
                }).join('');
            }
        }
        if (totalPendenteEl) totalPendenteEl.innerText = `R$ ${totalGeral.toFixed(2)}`;
    } catch (err) { console.error("Erro no resumo/filtros:", err); }

    // 4. Histórico de Corridas - ATUALIZADO PARA MOSTRAR QUEM CRIOU
    try {
        const dividas = await api.getMinhasDividas();
        const containerLista = document.getElementById('lista-dividas');
        
        if (containerLista) {
            if (dividas.length === 0) {
                containerLista.innerHTML = "<p style='color:#888; text-align:center;'>Nenhuma corrida encontrada.</p>";
            } else {
                containerLista.innerHTML = dividas.map(item => {
                    // Busca o nome de quem criou a corrida
                    const criadorId = item.rides.criado_por;
                    const infoCriador = amigos.find(a => a.id === criadorId);
                    const nomeCriador = criadorId === user.id ? "Você" : (infoCriador ? infoCriador.nome : "Outro");

                    return `
                        <div class="debt-item ${item.pago ? 'paid' : ''}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
                            <div>
                                <strong style="display:block;">R$ ${item.valor_parcela.toFixed(2)}</strong>
                                <small style="color: #666;">Paga por: <b>${nomeCriador}</b></small><br>
                                <small style="color: #999;">${new Date(item.rides.data_corrida).toLocaleDateString()}</small>
                            </div>
                            <span class="badge" style="padding: 4px 8px; border-radius: 4px; font-size: 10px; background: ${item.pago ? '#d4edda' : '#f8d7da'}">
                                ${item.pago ? 'Pago' : 'Pendente'}
                            </span>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (err) { console.error("Erro histórico:", err); }
},

    // FUNÇÃO PARA ATUALIZAR O VALOR AO CLICAR NO FILTRO
    filtrarPorUsuario(nome, valor) {
        const totalPendenteEl = document.getElementById('total-pendente');
        if (totalPendenteEl) {
            totalPendenteEl.innerHTML = `
                <small style="display:block; font-size:12px; font-weight:normal;">Deve para ${nome}:</small>
                R$ ${valor.toFixed(2)}
            `;
        }
    },

    async handleCreateRide() {
        const val = document.getElementById('valor').value;
        const checks = document.querySelectorAll('.user-check:checked');
        const ids = Array.from(checks).map(c => c.value);

        if (!val || ids.length === 0) {
            alert("Preencha o valor e selecione quem participou!");
            return;
        }

        try {
            await api.createRide(parseFloat(val), ids);
            alert("Corrida dividida com sucesso!");
            location.reload();
        } catch (err) {
            alert("Erro: " + err.message);
        }
    }
};

// --- FUNÇÕES GLOBAIS ---
async function login() {
    const email = document.getElementById('email').value;
    const senha = document.getElementById('senha').value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
    if (error) alert("Erro: " + error.message);
    else window.location.href = 'dashboard.html';
}

function logout() { api.logout(); }

// --- INICIALIZAÇÃO ---
window.addEventListener('load', async () => {
    const user = await api.getCurrentUser();
    const path = window.location.pathname;

    if (!user && (path.includes('dashboard.html') || path.endsWith('/dashboard'))) {
        window.location.href = 'index.html';
    } 
    else if (user && (path.includes('dashboard.html') || path.endsWith('/dashboard'))) {
        await ui.renderDashboard();
    }
});