import {
  apply, applyTemplates,
  chain, forEach,
  MergeStrategy,
  mergeWith,
  move,
  Rule, SchematicContext,
  SchematicsException,
  Tree,
  url
} from '@angular-devkit/schematics';
import {Schema} from './schema';
import {experimental, strings} from '@angular-devkit/core';
import {Observable, of} from 'rxjs';
import {concatMap, map} from 'rxjs/operators';
import { getLatestNodeVersion, NpmRegistryPackage } from '../util/npmjs';
import { addPackageJsonDependency, NodeDependency, NodeDependencyType } from '@schematics/angular/utility/dependencies';
import {NodePackageInstallTask} from '@angular-devkit/schematics/tasks';
import {addImportToModule} from '../util/module-utils';
import {createSourceFile, ScriptTarget, SourceFile} from 'typescript';
import {InsertChange} from '../util/change';

function readIntoSourceFile(host: Tree, modulePath: string): SourceFile {
  const text = host.read(modulePath);
  if (text === null) {
    throw new SchematicsException(`File ${modulePath} does not exist.`);
  }
  const sourceText = text.toString('utf-8');

  return createSourceFile(modulePath, sourceText, ScriptTarget.Latest, true);
}

function addDeclarationToNgModule(): Rule {
  return (host: Tree) => {

    const type = 'Module';
    const modulePath = '/src/app/app.module.ts';
    const source = readIntoSourceFile(host, modulePath);

    const relativePath = './core/core.module';
    const classifiedName = strings.classify('core') + strings.classify(type);
    const declarationChanges = addImportToModule(source,
        modulePath,
        classifiedName,
        relativePath);

    const declarationRecorder = host.beginUpdate(modulePath);
    for (const change of declarationChanges) {
      if (change instanceof InsertChange) {
        declarationRecorder.insertLeft(change.pos, change.toAdd);
      }
    }
    host.commitUpdate(declarationRecorder);

    const sourceRouting = readIntoSourceFile(host, modulePath);
    const relativePathRouting = './app-routing.module';
    const classifiedNameRouting = strings.classify('app-routing') + strings.classify(type);
    const declarationChangesRouting = addImportToModule(sourceRouting,
        modulePath,
        classifiedNameRouting,
        relativePathRouting);

    const declarationRecorderRouting = host.beginUpdate(modulePath);
    for (const change of declarationChangesRouting) {
      if (change instanceof InsertChange) {
        declarationRecorderRouting.insertLeft(change.pos, change.toAdd);
      }
    }
    host.commitUpdate(declarationRecorderRouting);

    return host;
  };
}

export function core(options: Schema): Rule {
  return (tree: Tree) => {
    const workspaceConfig = tree.read('/angular.json');
    if (!workspaceConfig) {
      throw new SchematicsException('Could not find Angular workspace configuration');
    }

    // convert workspace to string
    const workspaceContent = workspaceConfig.toString();

    // parse workspace string into JSON object
    const workspace: experimental.workspace.WorkspaceSchema = JSON.parse(workspaceContent);

    console.log(workspace);
    if (!options.project) {
      options.project = workspace.defaultProject;
    }

    const projectName = options.project as string;

    const project = workspace.projects[projectName];

    const projectType = project.projectType === 'application' ? 'app' : 'lib';

    if (options.path === undefined) {
      options.path = `${project.sourceRoot}/${projectType}`;
    }

    const templateSource = apply(url('./files'), [
      applyTemplates({
        classify: strings.classify,
        dasherize: strings.dasherize,
        encapsulation: options.encapsulation
      }),
      move(options.path),
      forEach(fileEntry => {
        if (tree.exists(fileEntry.path)) {
          tree.overwrite(fileEntry.path, fileEntry.content);
        } else {
          tree.create(fileEntry.path, fileEntry.content);
        }
        return null;
      })
    ]);

    return chain([
      addDeclarationToNgModule(),
      addPackageJsonDependencies(),
      installDependencies(),
      mergeWith(templateSource, MergeStrategy.Overwrite)
      ]);
  };

  function addPackageJsonDependencies(): Rule {
    return (tree: Tree, context: SchematicContext): Observable<Tree> => {
      return of('firebase', '@angular/fire').pipe(
        concatMap(name => getLatestNodeVersion(name)),
        map((npmRegistryPackage: NpmRegistryPackage) => {
          const nodeDependency: NodeDependency = {
            type: NodeDependencyType.Default,
            name: npmRegistryPackage.name,
            version: npmRegistryPackage.version,
            overwrite: false
          };
          addPackageJsonDependency(tree, nodeDependency);
          context.logger.info('✅️ Added dependency ' + npmRegistryPackage.name);
          return tree;
        })
      );
    };
  }
}

function installDependencies(): Rule {
  return (tree: Tree, context: SchematicContext) => {
    context.addTask(new NodePackageInstallTask());
    context.logger.debug('✅️ Dependencies installed');
    return tree;
  };
}


