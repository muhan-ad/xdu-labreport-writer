import { Repository } from '../domain/repository.ts';
import { privateStore } from './storage.ts';
import builtins from '../data/ai-skills.json';
import type {Skill} from '../domain/ai-library.ts';
export const builtinSkills=builtins as Skill[];
export const skillRepository=new Repository(privateStore);
export const loadSkills=()=>skillRepository.loadSkills(builtinSkills);
