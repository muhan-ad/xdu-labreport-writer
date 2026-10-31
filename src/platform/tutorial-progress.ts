import { Repository } from "../domain/repository.ts";
import { privateStore } from "./storage.ts";
export const tutorialProgress = new Repository(privateStore);
