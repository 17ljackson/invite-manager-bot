import { Command, CommandDecorators, Message, Middleware, Logger, logger, KeyedStorage } from 'yamdbf';
import { Channel, RichEmbed } from 'discord.js';
import { createEmbed } from '../utils/util';
import { Op } from 'sequelize';
import { joins, inviteCodes, sequelize, members, customInvites } from '../sequelize';
import { IMClient } from '../client';
const { resolve } = Middleware;
const { using } = CommandDecorators;

export default class extends Command<IMClient> {
  @logger('Command')
  private readonly _logger: Logger;

  public constructor() {
    super({
      name: 'leaderboard',
      aliases: ['top'],
      desc: 'Show members with most invites. You can pass it a channel and only invites in that channel will be counted.',
      usage: '<prefix>leaderboard (#channel)',
      clientPermissions: ['MANAGE_GUILD'],
      guildOnly: true
    });
  }

  @using(resolve('channel: Channel'))
  public async action(message: Message, [channel]: [Channel]): Promise<any> {
    this._logger.log(`${message.guild.name} (${message.author.username}): ${message.content}`);

    const where: { guildId: string, channelId?: string } = {
      guildId: message.guild.id,
    };
    if (channel) {
      where.channelId = channel.id;
    }

    let codeInvs = await inviteCodes.findAll({
      attributes: [
        [sequelize.fn('sum', sequelize.col('inviteCode.uses')), 'totalUses']
      ],
      where,
      group: 'inviteCode.inviterId',
      include: [{ model: members, as: 'inviter' }]
    });
    let customInvs = await customInvites.findAll({
      attributes: [
        [sequelize.fn('sum', sequelize.col('customInvite.amount')), 'totalAmount']
      ],
      where: {
        guildId: message.guild.id,
      },
      group: 'customInvite.memberId',
      include: [members]
    });

    const invs: { [x: string]: { name: string, code: number, bonus: number, last24hours: number, position24hoursAgo: number } } = {};
    codeInvs.forEach(inv => {
      invs[inv.inviter.id] = {
        name: inv.inviter.name,
        code: parseInt(inv.get('totalUses')),
        bonus: 0,
        last24hours: 0,
        position24hoursAgo: 0
      };
    });
    customInvs.forEach(inv => {
      if (invs[inv.member.id]) {
        invs[inv.member.id].bonus = parseInt(inv.get('totalAmount'));
      } else {
        invs[inv.member.id] = {
          name: inv.member.name,
          code: 0,
          bonus: parseInt(inv.get('totalAmount')),
          last24hours: 0,
          position24hoursAgo: 0
        };
      }
    });

    const js = await joins.findAll({
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('join.id')), 'totalJoins']
      ],
      where: {
        ...where,
        createdAt: {
          [Op.gt]: new Date(new Date().getTime() - (24 * 60 * 60 * 1000))
        }
      },
      group: ['join.memberId'],
      include: [{
        model: inviteCodes,
        as: 'exactMatch',
        include: [{ model: members, as: 'inviter' }]
      }],
    });

    js.forEach(j => {
      invs[j.exactMatch.inviter.id].last24hours = j.get('totalJoins');
    });

    const keys = Object.keys(invs)
      .filter(k => invs[k].bonus + invs[k].code > 0)
      .sort((a, b) => (invs[b].code + invs[b].bonus) - (invs[a].code + invs[a].bonus));

    const leaderboard24hAgo = keys.sort((a, b) => (invs[b].code + invs[b].bonus - invs[b].last24hours) - (invs[a].code + invs[a].bonus - invs[a].last24hours));

    let str = `Leaderboard ${channel ? 'for channel <#' + channel.id + '>' : ''}\n\n`;

    // TODO: Calculate positions

    // TODO: Compare to 1 day ago
    // let upSymbol = '🔺';
    // let downSymbol = '🔻';
    // let neutralSymbol = '▪️';
    if (keys.length === 0) {
      str += 'No invites!';
    } else {
      keys.slice(0, 50).forEach((k, i) => {
        str += `${(i + 1)} ▪️ ** ${invs[k].name}** ${invs[k].code + invs[k].bonus} invites (**${invs[k].bonus}** bonus)\n`;
      });
    }

    const embed = new RichEmbed().setDescription(str);
    createEmbed(message.client, embed);

    message.channel.send({ embed });
  }
}
