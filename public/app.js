const CONFIG = {
    URL: "https://tueewgpkotikpyniurlk.supabase.co",
    KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1ZWV3Z3Brb3Rpa3B5bml1cmxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTk1OTQsImV4cCI6MjA5MDczNTU5NH0.CRGDlx3tIokpMEVj4PD2L1H431JdGwvsAahc8XJfghc"
};

const supabaseClient = window.supabase.createClient(CONFIG.URL, CONFIG.KEY);

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

    async getDividasAgrupadas() {
        const user = await this.getCurrentUser();
        const dividas = await this.getMinhasDividas();
        const amigos = await this.getAmigos();
        const pendentes = dividas.filter(d => !d.pago);

        return pendentes.reduce((acc, item) => {
            const credorId = item.rides.criado_por;
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
        
        // 1. Criar a corrida
        const { data: ride, error: rErr } = await supabaseClient
            .from('rides')
            .insert({ criado_por: user.id, valor_total: totalValue })
            .select().single();

        if (rErr) throw rErr;

        const share = totalValue / idsParticipantes.length;

        // 2. Processar cada participante com lógica de abatimento
        for (const idAmigo of idsParticipantes) {
            if (idAmigo === user.id) {
                // Host já marcou como pago
                await supabaseClient.from('ride_participants').insert({
                    ride_id: ride.id,
                    user_id: idAmigo,
                    valor_parcela: share,
                    pago: true
                });
                continue;
            }

            // --- LÓGICA DE ABATIMENTO (NETTING) ---
            // Busca se EU (user.id) devo para ESSE AMIGO (idAmigo)
            const { data: dividasAntigas } = await supabaseClient
                .from('ride_participants')
                .select(`id, valor_parcela, rides!inner(criado_por)`)
                .eq('user_id', user.id)
                .eq('rides.criado_por', idAmigo)
                .eq('pago', false)
                .order('valor_parcela', { ascending: true });

            let valorQueAmigoMeDeveNestaCorrida = share;

            if (dividasAntigas && dividasAntigas.length > 0) {
                for (let divida of dividasAntigas) {
                    if (valorQueAmigoMeDeveNestaCorrida <= 0) break;

                    if (divida.valor_parcela <= valorQueAmigoMeDeveNestaCorrida) {
                        // Abate a dívida inteira que eu tinha com ele
                        valorQueAmigoMeDeveNestaCorrida -= divida.valor_parcela;
                        await supabaseClient
                            .from('ride_participants')
                            .update({ pago: true, valor_parcela: 0 })
                            .eq('id', divida.id);
                    } else {
                        // Abate apenas uma parte da minha dívida antiga
                        const novoValorMinhaDivida = divida.valor_parcela - valorQueAmigoMeDeveNestaCorrida;
                        await supabaseClient
                            .from('ride_participants')
                            .update({ valor_parcela: novoValorMinhaDivida })
                            .eq('id', divida.id);
                        valorQueAmigoMeDeveNestaCorrida = 0;
                    }
                }
            }

            // 3. Registrar a participação do amigo
            // Se o valor dele chegou a 0, significa que a dívida foi totalmente abatida
            await supabaseClient.from('ride_participants').insert({
                ride_id: ride.id,
                user_id: idAmigo,
                valor_parcela: valorQueAmigoMeDeveNestaCorrida,
                pago: valorQueAmigoMeDeveNestaCorrida <= 0
            });
        }
    }
};

// --- MÓDULO DE INTERFACE (UI) ---
const ui = {
    async renderDashboard() {
        const user = await api.getCurrentUser();
        if (!user) return;

        const infoDiv = document.getElementById('user-info');
        if (infoDiv) infoDiv.innerText = `Olá, ${user.email.split('@')[0]}`;

        const amigos = await api.getAmigos();

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
                                <strong style="color: #d32f2f;">R$ ${resumo[id].total.toFixed(2)}</strong>
                            </div>
                        `;
                    }).join('');
                }
            }
            if (totalPendenteEl) totalPendenteEl.innerText = `R$ ${totalGeral.toFixed(2)}`;
        } catch (err) { console.error("Erro resumo:", err); }

        try {
            const dividas = await api.getMinhasDividas();
            const containerLista = document.getElementById('lista-dividas');
            
            if (containerLista) {
                if (dividas.length === 0) {
                    containerLista.innerHTML = "<p style='color:#888; text-align:center;'>Nenhuma corrida encontrada.</p>";
                } else {
                    containerLista.innerHTML = dividas.map(item => {
                        const criadorId = item.rides.criado_por;
                        const infoCriador = amigos.find(a => a.id === criadorId);
                        const nomeCriador = criadorId === user.id ? "Você" : (infoCriador ? infoCriador.nome : "Outro");

                        return `
                            <div class="debt-item ${item.pago ? 'paid' : ''}" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #eee; margin-bottom: 8px; background: white; border-radius: 8px;">
                                <div>
                                    <strong style="display:block; font-size: 16px;">R$ ${item.valor_parcela.toFixed(2)}</strong>
                                    <small style="color: #666;">Paga por: <b>${nomeCriador}</b></small><br>
                                    <small style="color: #999;">${new Date(item.rides.data_corrida).toLocaleDateString()}</small>
                                </div>
                                <span class="badge" style="padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: bold; background: ${item.pago ? '#e8f5e9' : '#ffebee'}; color: ${item.pago ? '#2e7d32' : '#c62828'};">
                                    ${item.pago ? 'Pago' : 'Pendente'}
                                </span>
                            </div>
                        `;
                    }).join('');
                }
            }
        } catch (err) { console.error("Erro histórico:", err); }
    },

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
            alert("Corrida registrada! Valores abatidos se houvesse dívida anterior.");
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