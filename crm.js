import { db } from './firebase-config.js';
import { collection, getDocs, addDoc, updateDoc, doc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// === 1. VARIÁVEIS GLOBAIS ===
let demandasMemoria = [];
let templatesMemoria = [];
let metricasAgrupadas = {};

// === 2. FUNÇÕES AUXILIARES ===

// Formata a data e captura dia da semana automaticamente
function gerarTimestampCompleto() {
    const agora = new Date();
    const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    
    return {
        iso: agora.toISOString(),
        diaSemana: dias[agora.getDay()],
        formatada: agora.toLocaleString('pt-BR')
    };
}

// Limpa formatação de telefone para a API do WhatsApp (Mantém apenas números)
function limparNumeroTelefone(numero) {
    return numero.replace(/\D/g, '');
}

// Mostra mensagem temporária na tela (Radar de Demandas)
function mostrarMensagem(tipo, texto) {
    const msgBox = document.getElementById('msgDemanda');
    msgBox.className = `mensagem ${tipo}`;
    msgBox.innerText = texto;
    msgBox.style.display = 'block';
    setTimeout(() => { msgBox.style.display = 'none'; }, 4000);
}

// === 3. MOTOR DA FERRAMENTA 1: RADAR DE DEMANDAS ===

// Listener Real-time do Firestore para ler as Demandas
const qDemandas = query(collection(db, "demandas_registro"), orderBy("data_hora", "desc"));
onSnapshot(qDemandas, (snapshot) => {
    demandasMemoria = [];
    metricasAgrupadas = {};
    
    snapshot.forEach(doc => {
        const d = doc.data();
        
        if (d.status !== 'excluido') { // Soft Delete: Só carrega o que não foi "excluído"
            demandasMemoria.push({ id: doc.id, ...d });
            
            // Agrupamento Matemático para a Métrica (Sensível a minúsculas e remove espaços)
            const termoMetrica = d.interesse.toLowerCase().trim();
            if(!metricasAgrupadas[termoMetrica]) {
                metricasAgrupadas[termoMetrica] = { count: 0, itens: [] };
            }
            metricasAgrupadas[termoMetrica].count++;
            metricasAgrupadas[termoMetrica].itens.push({ id: doc.id, ...d });
        }
    });
    
    renderizarDemandas();
});

// Renderiza a lista de Demandas (já agrupada por métrica)
function renderizarDemandas() {
    const lista = document.getElementById('listaDemandas');
    const filtro = document.getElementById('buscaMetrica').value.toLowerCase().trim();
    lista.innerHTML = '';
    
    // Transforma o objeto de métricas em Array para ordenar (Maior demanda no topo)
    const arrayMetricas = Object.keys(metricasAgrupadas).map(chave => {
        return {
            termo: chave,
            quantidade: metricasAgrupadas[chave].count,
            registros: metricasAgrupadas[chave].itens
        };
    }).sort((a, b) => b.quantidade - a.quantidade);
    
    if(arrayMetricas.length === 0) {
        lista.innerHTML = '<p style="text-align:center; color:#888; padding: 20px;">Nenhuma demanda registrada ainda.</p>';
        return;
    }

    arrayMetricas.forEach(metrica => {
        if(filtro && !metrica.termo.includes(filtro)) return; // Filtro de busca local
        
        // Pega o registro mais recente desse termo para exibir os detalhes na interface
        const registroRecente = metrica.registros[0];
        
        const card = document.createElement('div');
        card.className = 'demanda-card';
        card.innerHTML = `
            <div class="demanda-header">
                <span class="demanda-interesse">${registroRecente.interesse}</span>
                <span class="demanda-metricas">🔥 ${metrica.quantidade} busca(s)</span>
            </div>
            <div class="demanda-detalhes">
                <strong>Último detalhe:</strong> ${registroRecente.detalhes || '<em>Nenhum detalhe adicional.</em>'}
            </div>
            <div class="demanda-rodape">
                <span>📅 ${registroRecente.dia_semana} (${registroRecente.data_hora_formatada})</span>
                <div class="demanda-acoes">
                    <button class="btn-acao btn-editar" onclick="window.editarDemanda('${registroRecente.id}')">Editar</button>
                    <button class="btn-acao btn-historico" onclick="window.abrirHistorico('${registroRecente.id}')">Histórico</button>
                    <button class="btn-acao btn-excluir" onclick="window.excluirDemanda('${registroRecente.id}')">Excluir</button>
                </div>
            </div>
        `;
        lista.appendChild(card);
    });
}

// Filtro em tempo real no input de busca
document.getElementById('buscaMetrica').addEventListener('input', renderizarDemandas);

// Salvar / Registrar Nova Demanda
document.getElementById('formDemanda').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSalvarDemanda');
    btn.disabled = true;
    btn.innerText = 'Salvando...';

    const idEdit = document.getElementById('demandaId').value;
    const interesse = document.getElementById('interesse').value.trim();
    const detalhes = document.getElementById('detalhes').value.trim();
    const tempo = gerarTimestampCompleto();

    try {
        if (idEdit) {
            // Rotina de Edição (Gera log de histórico IMUTÁVEL antes de sobrescrever)
            const demandaAntiga = demandasMemoria.find(d => d.id === idEdit);
            const novoHistorico = demandaAntiga.historico || [];
            
            novoHistorico.push({
                data_alteracao: tempo.formatada,
                acao: 'Editado',
                texto_antigo: `Interesse antigo: ${demandaAntiga.interesse} | Detalhe antigo: ${demandaAntiga.detalhes}`
            });

            await updateDoc(doc(db, "demandas_registro", idEdit), {
                interesse: interesse,
                detalhes: detalhes,
                historico: novoHistorico
            });
            mostrarMensagem('sucesso', 'Demanda atualizada com sucesso!');
            cancelarEdicao();

        } else {
            // Rotina de Criação
            await addDoc(collection(db, "demandas_registro"), {
                interesse: interesse,
                detalhes: detalhes,
                data_hora: tempo.iso,
                data_hora_formatada: tempo.formatada,
                dia_semana: tempo.diaSemana,
                status: 'ativo',
                historico: [{
                    data_alteracao: tempo.formatada,
                    acao: 'Criado',
                    texto_antigo: 'Registro inicial.'
                }]
            });
            mostrarMensagem('sucesso', 'Interesse registrado no radar!');
            document.getElementById('formDemanda').reset();
        }
    } catch (error) {
        console.error(error);
        mostrarMensagem('erro', 'Erro ao salvar. Verifique a conexão com o Firebase.');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Registrar Interesse no Radar';
    }
});

// Preparar formulário para Edição
window.editarDemanda = (id) => {
    const demanda = demandasMemoria.find(d => d.id === id);
    if (!demanda) return;

    document.getElementById('demandaId').value = demanda.id;
    document.getElementById('interesse').value = demanda.interesse;
    document.getElementById('detalhes').value = demanda.detalhes;
    
    document.getElementById('btnSalvarDemanda').innerText = 'Atualizar Demanda';
    document.getElementById('btnCancelarEdicao').style.display = 'block';
    
    // Rola a tela suavemente para o formulário no mobile
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Cancelar modo de Edição
function cancelarEdicao() {
    document.getElementById('formDemanda').reset();
    document.getElementById('demandaId').value = '';
    document.getElementById('btnSalvarDemanda').innerText = 'Registrar Interesse no Radar';
    document.getElementById('btnCancelarEdicao').style.display = 'none';
}
document.getElementById('btnCancelarEdicao').addEventListener('click', cancelarEdicao);

// Excluir Demanda (Soft Delete: Apenas muda o status no banco, preservando auditoria)
window.excluirDemanda = async (id) => {
    if(!confirm('Tem certeza que deseja remover este registro do radar?')) return;
    
    try {
        const demanda = demandasMemoria.find(d => d.id === id);
        const tempo = gerarTimestampCompleto();
        const novoHistorico = demanda.historico || [];
        
        novoHistorico.push({
            data_alteracao: tempo.formatada,
            acao: 'Excluído',
            texto_antigo: 'Usuário arquivou/removeu o registro da métrica.'
        });

        await updateDoc(doc(db, "demandas_registro", id), {
            status: 'excluido',
            historico: novoHistorico
        });
    } catch (e) {
        alert("Erro ao excluir.");
    }
}

// Modal de Histórico de Alterações
window.abrirHistorico = (id) => {
    const demanda = demandasMemoria.find(d => d.id === id);
    if (!demanda) return;

    const divHist = document.getElementById('conteudoHistorico');
    divHist.innerHTML = '';
    
    if (!demanda.historico || demanda.historico.length === 0) {
        divHist.innerHTML = '<p>Nenhum histórico registrado.</p>';
    } else {
        // Inverte a array para exibir do mais recente (topo) para o mais antigo (fundo)
        const histReverso = [...demanda.historico].reverse();
        
        histReverso.forEach(h => {
            divHist.innerHTML += `
                <div class="historico-item">
                    <span class="historico-data">${h.data_alteracao} - ${h.acao}</span>
                    <div class="historico-texto">${h.texto_antigo}</div>
                </div>
            `;
        });
    }
    
    document.getElementById('modalHistorico').style.display = 'block';
}

window.fecharModalHistorico = () => {
    document.getElementById('modalHistorico').style.display = 'none';
}


// === 4. MOTOR DA FERRAMENTA 2: DISPARADOR WHATSAPP ===

// Listener Real-time para puxar os Templates
const qTemplates = query(collection(db, "whatsapp_templates"));
onSnapshot(qTemplates, (snapshot) => {
    templatesMemoria = [];
    const select = document.getElementById('zapTemplate');
    
    // Resetando e mantendo a opção padrão "Avulsa"
    select.innerHTML = '<option value="">-- Mensagem Avulsa (Digitar abaixo) --</option>';
    
    snapshot.forEach(doc => {
        const t = { id: doc.id, ...doc.data() };
        templatesMemoria.push(t);
        select.innerHTML += `<option value="${t.id}">${t.titulo}</option>`;
    });
});

// Preencher a textarea automaticamente quando seleciona um template
document.getElementById('zapTemplate').addEventListener('change', (e) => {
    const id = e.target.value;
    const txtArea = document.getElementById('zapMensagem');
    if (!id) {
        txtArea.value = '';
        return;
    }
    const template = templatesMemoria.find(t => t.id === id);
    if (template) {
        txtArea.value = template.corpo;
    }
});

// Salvar Novo Template de Mensagem Rápida
document.getElementById('formTemplate').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titulo = document.getElementById('tituloTemplate').value.trim();
    const corpo = document.getElementById('textoTemplate').value.trim();
    const btn = e.target.querySelector('button');
    
    btn.disabled = true;
    btn.innerText = 'Salvando...';

    try {
        await addDoc(collection(db, "whatsapp_templates"), {
            titulo: titulo,
            corpo: corpo
        });
        document.getElementById('formTemplate').reset();
        alert('Template salvo com sucesso!');
    } catch (err) {
        alert('Erro ao salvar template.');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Salvar Template no Banco';
    }
});

// Disparador Principal (Gatilho para abrir no WhatsApp)
document.getElementById('btnEnviarZap').addEventListener('click', () => {
    let numero = document.getElementById('zapNumero').value.trim();
    const mensagem = document.getElementById('zapMensagem').value.trim();

    if (!numero) {
        alert("Digite o número do cliente.");
        document.getElementById('zapNumero').focus();
        return;
    }
    if (!mensagem) {
        alert("Escreva uma mensagem ou selecione um template.");
        document.getElementById('zapMensagem').focus();
        return;
    }

    // A mágica: limpa qualquer traço, parêntese ou espaço que o vendedor digitar
    numero = limparNumeroTelefone(numero);
    
    // Adiciona o DDI do Brasil (+55) caso o vendedor tenha esquecido
    if (numero.length <= 11) {
        numero = "55" + numero;
    }

    // Codifica a mensagem para o padrão de URL da API do WhatsApp
    const url = `https://api.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(mensagem)}`;
    
    // Abre a conversa em uma nova aba do navegador (ou abre o App no celular)
    window.open(url, '_blank');
});

// Fechar os modais ao clicar fora da caixa branca
window.onclick = function(event) {
    const modal = document.getElementById('modalHistorico');
    if (event.target == modal) {
        fecharModalHistorico();
    }
}
