import { describe, expect, it } from 'vitest';
import {
  AI_CARD_TEMPLATE_ID,
  FLOW_STATUS,
  buildCreateBody,
  buildDeliverBody,
  buildFinishBody,
  buildStreamingBody,
  type CardTarget,
} from '@xiaosu/bot';

const TARGET_GROUP: CardTarget = {
  appKey: 'app-key-1',
  conversationId: 'cid-group',
  conversationType: '2',
  senderStaffId: 'staff-001',
};

const TARGET_SINGLE: CardTarget = {
  appKey: 'app-key-1',
  conversationId: 'cid-single',
  conversationType: '1',
  senderStaffId: 'staff-001',
};

describe('钉钉 AI 卡片请求体（对照官方 Python SDK 配方）', () => {
  it('创建卡片：内置模板 + STREAM 回调 + 处理中状态', () => {
    const body = buildCreateBody('track-1', '小苏') as {
      cardTemplateId: string;
      callbackType: string;
      outTrackId: string;
      cardData: { cardParamMap: Record<string, unknown> };
    };
    expect(body.cardTemplateId).toBe(AI_CARD_TEMPLATE_ID);
    expect(body.callbackType).toBe('STREAM');
    expect(body.outTrackId).toBe('track-1');
    const param = body.cardData.cardParamMap;
    expect(param.flowStatus).toBe(FLOW_STATUS.PROCESSING);
    expect(param.msgTitle).toBe('小苏');
  });

  it('投放：群聊走 IM_GROUP 空间并携带 robotCode', () => {
    const body = buildDeliverBody('track-1', TARGET_GROUP) as Record<string, unknown>;
    expect(body.openSpaceId).toBe('dtv1.card//IM_GROUP.cid-group');
    expect((body.imGroupOpenDeliverModel as Record<string, unknown>).robotCode).toBe('app-key-1');
  });

  it('投放：单聊走 IM_ROBOT 空间（发送者维度）', () => {
    const body = buildDeliverBody('track-1', TARGET_SINGLE) as Record<string, unknown>;
    expect(body.openSpaceId).toBe('dtv1.card//IM_ROBOT.staff-001');
    expect((body.imRobotOpenDeliverModel as Record<string, unknown>).spaceType).toBe('IM_ROBOT');
  });

  it('流式更新：key=msgContent、全量替换、非终态', () => {
    const body = buildStreamingBody('track-1', '累计全文') as Record<string, unknown>;
    expect(body.key).toBe('msgContent');
    expect(body.content).toBe('累计全文');
    expect(body.isFull).toBe(true);
    expect(body.isFinalize).toBe(false);
    expect(body.isError).toBe(false);
  });

  it('完成态：flowStatus=FINISHED 整体更新', () => {
    const body = buildFinishBody('track-1', '小苏', '最终回答', FLOW_STATUS.FINISHED) as {
      cardData: { cardParamMap: Record<string, unknown> };
    };
    expect(body.cardData.cardParamMap.flowStatus).toBe(FLOW_STATUS.FINISHED);
    expect(body.cardData.cardParamMap.msgContent).toBe('最终回答');
  });
});
