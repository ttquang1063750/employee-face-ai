import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RealtimeService } from './realtime.service';
import { LeaveRequest } from '../models/leave-request.model';
import { ReceivedMessage } from '../models/message.model';

function makeLeaveRequest(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: 1,
    employee_id: 1,
    employee_name: 'Alice',
    current_position: 'Developer',
    start_date: '2026-01-01',
    end_date: '2026-01-02',
    reason: 'Nghỉ phép',
    status: 'pending',
    requested_at: '2026-01-01 08:00:00',
    ...overrides,
  };
}

function makeReceivedMessage(overrides: Partial<ReceivedMessage>): ReceivedMessage {
  return {
    id: 1,
    sender_id: 2,
    sender_name: 'Bob',
    category: 'daily_report',
    subject: 'Báo cáo ngày',
    content: 'Nội dung',
    is_read: false,
    created_at: '2026-01-01T08:00:00',
    ...overrides,
  };
}

describe('RealtimeService', () => {
  let service: RealtimeService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RealtimeService);
    // The constructor already fired one round of polling and started the
    // 3s interval — stop the interval so it can't fire again mid-test; the
    // computed signals under test only depend on the signals set directly
    // below, not on the HTTP calls the constructor already made.
    service.stopPolling();
  });

  describe('pendingLeaveCount', () => {
    it('is 0 with no leave requests', () => {
      service.leaveRequests.set([]);
      expect(service.pendingLeaveCount()).toBe(0);
    });

    it('counts only requests with status "pending"', () => {
      service.leaveRequests.set([
        makeLeaveRequest({ id: 1, status: 'pending' }),
        makeLeaveRequest({ id: 2, status: 'approved' }),
        makeLeaveRequest({ id: 3, status: 'pending' }),
        makeLeaveRequest({ id: 4, status: 'rejected' }),
      ]);
      expect(service.pendingLeaveCount()).toBe(2);
    });
  });

  describe('unreadMessageCount', () => {
    it('is 0 with no received messages', () => {
      service.receivedMessages.set([]);
      expect(service.unreadMessageCount()).toBe(0);
    });

    it('counts only messages with is_read false', () => {
      service.receivedMessages.set([
        makeReceivedMessage({ id: 1, is_read: false }),
        makeReceivedMessage({ id: 2, is_read: true }),
        makeReceivedMessage({ id: 3, is_read: false }),
      ]);
      expect(service.unreadMessageCount()).toBe(2);
    });
  });
});
