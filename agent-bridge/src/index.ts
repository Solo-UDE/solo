#!/usr/bin/env node
/**
 * Agent Bridge Entry Point
 * Bridges Rust/Tauri backend with Claude Agent SDK via stdin/stdout JSON IPC
 */

import * as readline from 'readline';

import { createLogger } from './logger.js';
import { SessionManager } from './session-manager.js';

import type { BridgeEvent, BridgeRequest, BridgeResponse, CommandResponse } from './protocol.js';

const logger = createLogger('AgentBridge');

/**
 * Send a message to Rust via stdout
 * Uses newline-delimited JSON
 */
function sendMessage(message: BridgeResponse): void {
  const json = JSON.stringify(message);
  process.stdout.write(json + '\n');
}

/**
 * Send a command response
 */
function sendResponse(response: CommandResponse): void {
  sendMessage(response);
}

/**
 * Send an event
 */
function sendEvent(event: BridgeEvent): void {
  sendMessage(event);
}

/**
 * Main entry point
 */
function main(): void {
  logger.info('Agent Bridge starting...');

  // Create session manager
  const sessionManager = new SessionManager();

  // Wire up event handlers
  sessionManager.onAgentMessage((data) => {
    sendEvent({
      type: 'agent_message',
      sessionId: data.sessionId,
      message: data.message,
    });
  });

  sessionManager.onPermissionRequest((request) => {
    sendEvent({
      type: 'permission_request',
      request,
    });
  });

  sessionManager.onSessionInit((event) => {
    sendEvent({
      type: 'session_init',
      event,
    });
  });

  sessionManager.onPlanModeChanged((data) => {
    sendEvent({
      type: 'plan_mode_changed',
      sessionId: data.sessionId,
      enabled: data.enabled,
    });
  });

  sessionManager.onAcceptModeChanged((data) => {
    sendEvent({
      type: 'accept_mode_changed',
      sessionId: data.sessionId,
      enabled: data.enabled,
    });
  });

  sessionManager.onError((error) => {
    sendEvent({
      type: 'error_event',
      error,
    });
  });

  // Handle incoming requests from stdin
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }

    let request: BridgeRequest;
    try {
      request = JSON.parse(line) as BridgeRequest;
    } catch (error) {
      logger.error({ error, line }, 'Failed to parse request');
      sendResponse({
        type: 'error',
        requestType: 'unknown',
        error: `Failed to parse request: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    logger.info({ requestType: request.type }, 'Received request');

    handleRequest(request, sessionManager).catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ requestType: request.type, error: errorMessage }, 'Error handling request');
      sendResponse({
        type: 'error',
        requestType: request.type,
        error: errorMessage,
      });
    });
  });

  rl.on('close', () => {
    logger.info('stdin closed, shutting down...');
    sessionManager.dispose();
    process.exit(0);
  });

  // Handle process signals
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down...');
    sessionManager.dispose();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down...');
    sessionManager.dispose();
    process.exit(0);
  });

  // Send ready event
  sendEvent({ type: 'ready' });
  logger.info('Agent Bridge ready');
}

/**
 * Handle a single request
 */
async function handleRequest(
  request: BridgeRequest,
  sessionManager: SessionManager
): Promise<void> {
  switch (request.type) {
    case 'create_session': {
      sessionManager.createSession(request.sessionId, request.config);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'delete_session': {
      await sessionManager.deleteSession(request.sessionId);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'send_message': {
      sessionManager.sendMessage(request.message, request.sessionId, request.attachments);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'interrupt': {
      await sessionManager.interrupt(request.sessionId);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'permission_response': {
      sessionManager.respondToPermission(request.response);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'set_thinking_mode': {
      await sessionManager.setThinkingMode(request.sessionId, request.enabled, request.maxTokens);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'get_thinking_mode': {
      const enabled = sessionManager.getThinkingMode(request.sessionId);
      sendResponse({ type: 'boolean', requestType: request.type, value: enabled });
      break;
    }

    case 'set_model': {
      await sessionManager.setModel(request.sessionId, request.model);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'set_plan_mode': {
      sessionManager.setPlanMode(request.sessionId, request.enabled);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'get_plan_mode': {
      const enabled = sessionManager.getPlanMode(request.sessionId);
      sendResponse({ type: 'boolean', requestType: request.type, value: enabled });
      break;
    }

    case 'set_accept_mode': {
      sessionManager.setAcceptMode(request.sessionId, request.enabled);
      sendResponse({ type: 'success', requestType: request.type });
      break;
    }

    case 'get_accept_mode': {
      const enabled = sessionManager.getAcceptMode(request.sessionId);
      sendResponse({ type: 'boolean', requestType: request.type, value: enabled });
      break;
    }

    case 'is_session_ready': {
      const ready = sessionManager.isSessionReady(request.sessionId);
      sendResponse({ type: 'boolean', requestType: request.type, value: ready });
      break;
    }

    case 'get_sdk_session_id': {
      const sdkSessionId = sessionManager.getSDKSessionId(request.sessionId);
      sendResponse({ type: 'string', requestType: request.type, value: sdkSessionId ?? null });
      break;
    }

    case 'shutdown': {
      logger.info('Shutdown requested');
      sendResponse({ type: 'success', requestType: request.type });
      sessionManager.dispose();
      process.exit(0);
      break;
    }

    default: {
      const exhaustiveCheck: never = request;
      sendResponse({
        type: 'error',
        requestType: (exhaustiveCheck as BridgeRequest).type,
        error: `Unknown request type: ${(exhaustiveCheck as BridgeRequest).type}`,
      });
    }
  }
}

// Run main
try {
  main();
} catch (error: unknown) {
  logger.error({ error }, 'Fatal error');
  process.exit(1);
}
