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

    // No objeto api dentro do app.js
async getMinhasDividas() {
    const user = await this.getCurrentUser();
    const { data, error } = await supabaseClient
        .from('ride_participants')
        .select(`
            id,
            ride_id,
            valor_parcela,
            pago,
            rides (
                id,
                data_corrida,
                valor_total,
                criado_por
            )
        `)
        .eq('user_id', user.id)
        .order('rides(data_corrida)', { ascending: false });

    if (error) throw error;
    return data;
},

    // Dentro do objeto api no app.js
async getRelatorioGeralCompleto() {
    // Busca todas as participações não pagas de todos os usuários
    const { data, error } = await supabaseClient
        .from('ride_participants')
        .select(`
            user_id,
            valor_parcela,
            pago,
            profiles:user_id(nome, email),
            rides!inner(criado_por, profiles:criado_por(nome, email))
        `)
        .eq('pago', false);

    if (error) throw error;

    // Organiza os dados no formato: { Devedor: { Credor: Total } }
    return data.reduce((acc, item) => {
        const devedorNome = item.profiles.nome || item.profiles.email.split('@')[0];
        const credorNome = item.rides.profiles.nome || item.rides.profiles.email.split('@')[0];
        const valor = parseFloat(item.valor_parcela);

        // Se o devedor é a mesma pessoa que pagou (criador), ignora
        if (item.user_id === item.rides.criado_por) return acc;

        if (!acc[devedorNome]) acc[devedorNome] = {};
        if (!acc[devedorNome][credorNome]) acc[devedorNome][credorNome] = 0;

        acc[devedorNome][credorNome] += valor;
        return acc;
    }, {});
},

async fecharSemana() {
    try {
        // 1. Apaga participações (Dívidas)
        // Usamos .not('id', 'is', null) que funciona para qualquer tipo de ID
        const { error: errorPart } = await supabaseClient
            .from('ride_participants')
            .delete()
            .not('id', 'is', null); 

        if (errorPart) throw errorPart;

        // 2. Apaga as corridas (Histórico)
        const { error: errorRides } = await supabaseClient
            .from('rides')
            .delete()
            .not('id', 'is', null);

        if (errorRides) throw errorRides;

        return true;
    } catch (error) {
        console.error("Erro ao apagar registros:", error);
        throw error;
    }
},

    async getDividasAgrupadas() {
        const user = await this.getCurrentUser();
        const dividas = await api.getMinhasDividas();
        console.log("Minhas dívidas:", dividas); // Olhe no console qual é o nome do campo do ID
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

let rideIdSendoEditado = null;

// --- MÓDULO DE INTERFACE (UI) ---
const ui = {
   async renderDashboard() {
    const user = await api.getCurrentUser();
    if (!user) return;

    // 1. Saudação na Navbar
    const infoDiv = document.getElementById('user-info');
    if (infoDiv) infoDiv.innerText = `Olá, ${user.email.split('@')[0]}`;

    const amigos = await api.getAmigos();

    // 2. Renderizar Checkboxes (Para nova corrida)
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

    // 3. Resumo de Dívidas (Quanto você deve para cada um)
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
                    // Formata valor com vírgula para as Tabs
                    const valorTab = resumo[id].total.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                    return `
                        <div class="user-tab-item" 
                             style="background:#f0f2f5; padding:8px 15px; border-radius:20px; cursor:pointer; display:inline-block; margin:5px; border:1px solid transparent;"
                             onclick="ui.filtrarPorUsuario('${resumo[id].nome}', ${resumo[id].total})">
                            <span style="display:block; font-size:11px; color:#65676b;">${resumo[id].nome}</span>
                            <strong style="font-size:14px; color:#d32f2f;">R$ ${valorTab}</strong>
                        </div>
                    `;
                }).join('');
            }
        }
        // Atualiza o saldo total no topo com vírgula
        if (totalPendenteEl) {
            totalPendenteEl.innerText = `R$ ${totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        }
    } catch (err) { console.error("Erro resumo:", err); }

    // 4. Histórico de Corridas (Ordenado e com Valor Total)
    try {
        const dividas = await api.getMinhasDividas();
        const containerLista = document.getElementById('lista-dividas');
        
        if (containerLista) {
            if (dividas.length === 0) {
                containerLista.innerHTML = "<p style='color:#888; text-align:center;'>Nenhuma corrida encontrada.</p>";
            } else {
                const dividasOrdenadas = dividas.sort((a, b) => 
                    new Date(b.rides.data_corrida) - new Date(a.rides.data_corrida)
                );

                containerLista.innerHTML = dividasOrdenadas.map(item => {
                    const criadorId = item.rides.criado_por;
                    const infoCriador = amigos.find(a => a.id === criadorId);
                    const nomeCriador = criadorId === user.id ? "Você" : (infoCriador ? (infoCriador.nome || infoCriador.email.split('@')[0]) : "Outro");
                    
                    const dataFormatada = new Date(item.rides.data_corrida).toLocaleDateString('pt-BR');
                    const valorTotalStr = item.rides.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

                    // AQUI ESTÁ A MUDANÇA: Pegando o ID correto que vimos no console.log
                    const rideIdParaAcao = item.ride_id; 

                    return `
                        <div class="debt-item" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid #eee; margin-bottom: 12px; background: white; border-radius: 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.06);">
                            <div style="display: flex; flex-direction: column;">
                                <span style="font-size: 1.6rem; font-weight: 700; color: #000; line-height: 1.1; margin-bottom: 4px;">
                                    ${valorTotalStr}
                                </span>
                                <span style="font-size: 0.8rem; color: #666; font-weight: 400;">
                                    Paga por: ${nomeCriador} • ${dataFormatada}
                                </span>
                            </div>
                            
                            <div style="display: flex; gap: 8px; align-items: center;">
                                ${criadorId === user.id ? `
                                    <button onclick="ui.excluirCorrida('${rideIdParaAcao}')" style="border:none; background:none; cursor:pointer; font-size:1.2rem;" title="Excluir">🗑️</button>
                                    <button onclick="ui.abrirEdicao('${rideIdParaAcao}', ${item.rides.valor_total})" style="border:none; background:none; cursor:pointer; font-size:1.2rem;" title="Editar">✏️</button>
                                ` : ''}
                                
                                <span class="badge" style="padding: 6px 12px; border-radius: 20px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: ${item.pago ? '#e8f5e9' : '#ffebee'}; color: ${item.pago ? '#2e7d32' : '#c62828'};">
                                    ${item.pago ? 'Pago' : 'Pendente'}
                                </span>
                            </div>
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
            //alert("Corrida registrada! Valores abatidos se houvesse dívida anterior.");
            location.reload();
        } catch (err) {
            alert("Erro: " + err.message);
        }
    },

    // Dentro do objeto ui no app.js
// --- DENTRO DO OBJETO ui NO app.js ---
async mostrarRelatorioSemanal() {
    try {
        const relatorio = await api.getRelatorioGeralCompleto();
        const devedores = Object.keys(relatorio);
        const corpo = document.getElementById('corpo-relatorio');
        const modal = document.getElementById('modal-relatorio');

        if (devedores.length === 0) {
            alert("Ninguém deve nada a ninguém! Tudo limpo.");
            return;
        }

        // Constrói os blocos por usuário
        corpo.innerHTML = devedores.map(devedor => {
            const dividas = relatorio[devedor];
            const credores = Object.keys(dividas);
            
            // Gera a lista de quem esse usuário deve
            const listaDividas = credores.map(credor => `
                <div class="relatorio-sub-item">
                    <span>para <b>${credor}</b></span>
                    <strong>R$ ${dividas[credor].toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong>
                </div>
            `).join('');

            return `
                <div class="usuario-bloco">
                    <div class="usuario-header">
                        <i class="user-icon">👤</i> <span>${devedor} está devendo:</span>
                    </div>
                    <div class="usuario-dividas">
                        ${listaDividas}
                    </div>
                </div>
            `;
        }).join('');

        modal.style.display = 'flex';
    } catch (err) {
        console.error("Erro no relatório:", err);
    }
},
// --- DENTRO DO OBJETO ui ---

async excluirCorrida(rideId) {
    if (!confirm("Tem certeza que deseja apagar esta corrida? Isso limpará o histórico e as dívidas dela.")) return;

    try {
        // 1. Primeiro removemos os participantes (filhos)
        const { error: errorPart } = await supabaseClient
            .from('ride_participants')
            .delete()
            .eq('ride_id', rideId);
        
        if (errorPart) throw errorPart;

        // 2. Depois removemos a corrida (pai)
        const { error: errorRide } = await supabaseClient
            .from('rides')
            .delete()
            .eq('id', rideId);

        if (errorRide) throw errorRide;

        //alert("Corrida excluída com sucesso!");
        
        // 3. Forçar atualização completa
        await this.renderDashboard(); 
    } catch (err) {
        console.error("Erro ao excluir:", err);
        alert("Erro ao excluir no banco de dados. Verifique sua conexão ou permissões.");
    }
},

// --- SUBSTITUA A abrirEdicao ANTIGA POR ESTA ---
async abrirEdicao(rideId, valorAtual) {
    rideIdSendoEditado = rideId;
    const modal = document.getElementById('modal-editar');
    const inputValor = document.getElementById('edit-valor');
    const containerAmigos = document.getElementById('edit-lista-amigos');
    
    inputValor.value = valorAtual;
    modal.style.display = 'flex';

    try {
        const amigos = await api.getAmigos();
        const user = await api.getCurrentUser();
        
        // Busca quem já estava na corrida para marcar os boxes
        const { data: atuais } = await supabaseClient
            .from('ride_participants')
            .select('user_id')
            .eq('ride_id', rideId);

        const idsAtuais = atuais.map(p => p.user_id);

        containerAmigos.innerHTML = amigos.map(amigo => `
            <label class="checkbox-item">
                <input type="checkbox" class="edit-user-check" value="${amigo.id}" 
                    ${idsAtuais.includes(amigo.id) ? 'checked' : ''}
                    ${amigo.id === user.id ? 'checked disabled' : ''}>
                ${amigo.nome || amigo.email.split('@')[0]}
            </label>
        `).join('');

        // Configura o clique do botão salvar
        document.getElementById('btn-salvar-edicao').onclick = () => ui.salvarEdicao();
    } catch (err) {
        console.error(err);
    }
},

fecharModalEditar() {
    document.getElementById('modal-editar').style.display = 'none';
    rideIdSendoEditado = null;
},

async salvarEdicao() {
    const novoValor = parseFloat(document.getElementById('edit-valor').value);
    const checks = document.querySelectorAll('.edit-user-check:checked');
    const user = await api.getCurrentUser();
    
    let novosParticipantesIds = Array.from(checks).map(c => c.value);
    if (!novosParticipantesIds.includes(user.id)) novosParticipantesIds.push(user.id);

    if (isNaN(novoValor) || novosParticipantesIds.length === 0) {
        alert("Dados inválidos!");
        return;
    }

    try {
        // 1. Atualiza valor da corrida
        await supabaseClient.from('rides').update({ valor_total: novoValor }).eq('id', rideIdSendoEditado);

        // 2. Limpa e refaz participantes
        await supabaseClient.from('ride_participants').delete().eq('ride_id', rideIdSendoEditado);
        
        const share = novoValor / novosParticipantesIds.length;
        const novosDados = novosParticipantesIds.map(id => ({
            ride_id: rideIdSendoEditado,
            user_id: id,
            valor_parcela: share,
            pago: (id === user.id)
        }));

        await supabaseClient.from('ride_participants').insert(novosDados);

        //alert("Corrida atualizada!");
        window.location.reload();
    } catch (err) {
        alert("Erro ao salvar: " + err.message);
    }
},

fecharModal() {
    document.getElementById('modal-relatorio').style.display = 'none';
},

async confirmarFechamento() {
    if (confirm("Deseja realmente zerar o histórico de TODOS os usuários e iniciar uma nova semana?")) {
        try {
            await api.fecharSemana(); 
            this.fecharModal();
            
            // Força a atualização da tela para refletir o banco vazio
            await this.renderDashboard(); 
            
            alert("Semana encerrada para todos! O relatório e o histórico foram limpos.");
        } catch (err) {
            alert("Erro ao zerar semana: " + err.message);
        }
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