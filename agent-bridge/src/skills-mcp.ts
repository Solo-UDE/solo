/**
 * In-process MCP surface for Solo skills.
 *
 * Skills are discovered from Solo's canonical skill loader, but exposed lazily
 * through tools so the full skill corpus is not injected into every prompt.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { loadSkills } from './skills.js';

import type { LoadedSkill } from './skills.js';

function loadVisibleSkills(cwd: string, selectedSkills?: string[]): LoadedSkill[] {
  const all = loadSkills(cwd);
  if (!selectedSkills || selectedSkills.length === 0) {
    return all;
  }

  const selected = new Set(selectedSkills);
  return all.filter((skill) => selected.has(skill.metadata.name));
}

function renderSkillSummary(skill: LoadedSkill): string {
  const description = skill.metadata.description ? ` - ${skill.metadata.description}` : '';
  return `- ${skill.metadata.name}${description} (${skill.source})`;
}

export function createSkillsMcpServer(cwd: string, selectedSkills?: string[]) {
  const listTool = tool(
    'skill_list',
    'List Solo skills available to this session. Use this before reading a skill when the user asks for specialized instructions or references a skill by name.',
    {},
    async () => {
      const skills = loadVisibleSkills(cwd, selectedSkills);
      const body =
        skills.length === 0
          ? 'No Solo skills are available for this session.'
          : skills.map(renderSkillSummary).join('\n');

      return {
        content: [{ type: 'text', text: body }],
      };
    }
  );

  const readTool = tool(
    'skill_read',
    'Read the full instructions for one Solo skill by name.',
    {
      name: z.string().min(1).describe('Exact skill name returned by skill_list.'),
    },
    async ({ name }) => {
      const skills = loadVisibleSkills(cwd, selectedSkills);
      const skill = skills.find((candidate) => candidate.metadata.name === name);

      if (!skill) {
        return {
          content: [
            {
              type: 'text',
              text: `Skill "${name}" is not available in this session. Call skill_list to see available skills.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `# ${skill.metadata.name}\n\n${skill.content}`,
          },
        ],
      };
    }
  );

  return createSdkMcpServer({
    name: 'solo_skills',
    version: '0.1.0',
    tools: [listTool, readTool],
  });
}
