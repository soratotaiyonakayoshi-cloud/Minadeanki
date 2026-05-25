const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-quiz')
    .setDescription('新しいクイズを登録します')
    .addStringOption(option =>
      option.setName('genre')
        .setDescription('ジャンルを選択してください')
        .setRequired(true)
        .addChoices(
          { name: '🧪 有機化学', value: '有機化学' },
          { name: '⚗️ 無機化学', value: '無機化学' },
          { name: '📊 理論化学', value: '理論化学' },
          { name: '📝 一般常識', value: '一般常識' },
          { name: '📁 その他', value: 'その他' }
        )
    ),
  async execute(interaction) {
    const selectedGenre = interaction.options.getString('genre');
    const modal = new ModalBuilder().setCustomId(`addQuizModal_${selectedGenre}`).setTitle('新しいクイズを登録');
    
    const diffInput = new TextInputBuilder().setCustomId('diffInput').setLabel('難易度（例: ★3、共通テスト）').setStyle(TextInputStyle.Short).setRequired(true);
    const questionInput = new TextInputBuilder().setCustomId('questionInput').setLabel('問題文（必須）').setStyle(TextInputStyle.Paragraph).setRequired(true);
    const answerInput = new TextInputBuilder().setCustomId('answerInput').setLabel('答え（必須）').setStyle(TextInputStyle.Short).setRequired(true);
    const explInput = new TextInputBuilder().setCustomId('explInput').setLabel('解説文（任意）').setStyle(TextInputStyle.Paragraph).setRequired(false);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(diffInput),
      new ActionRowBuilder().addComponents(questionInput),
      new ActionRowBuilder().addComponents(answerInput),
      new ActionRowBuilder().addComponents(explInput)
    );
    await interaction.showModal(modal);
  },
};