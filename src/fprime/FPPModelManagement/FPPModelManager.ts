import IConfig from "../Common/Config";
import DataImporter, { IOutput } from "../DataImport/DataImporter";
import fs from 'fs';

/**
 * 
 */
export enum ViewType {
  Function = "Function View",
  InstanceCentric = "InstanceCentric View",
  Component = "Component View",
  PortType = "PortType View",
}

/**
 * A port type defined 
 */
export interface IFPPPortType {
  name: string;
  namespace: string;
  arg: { [key: string]: string };
}

/**
 * A port created in a component
 */
export interface IFPPPort {
  name: string;
  properties: { [key: string]: any };
}

/**
 * A component type
 */
export interface IFPPComponent {
  name: string;
  namespace: string;
  ports: IFPPPort[];
}

/**
 * A component instance
 */
export interface IFPPInstance {
  name: string;
  base_id: string;
  ports: { [p: string]: IFPPPort };
  properties: { [p: string]: string };
}

/**
 * A connection in the topology
 */
export interface IFPPConnection {
  from: { inst: IFPPInstance, port: IFPPPort };
  to: { inst: IFPPInstance, port: IFPPPort };
}

/**
 * A topology information in the functional view
 */
export interface IFPPTopology {
  name: string;
  connections: IFPPConnection[];
}

/**
 * The whole FPP model
 */
export interface IFPPModel {
  instances: IFPPInstance[];
  connections: IFPPConnection[];
  components: IFPPComponent[];
}

/**
 *
 */
export default class FPPModelManager {
  private dataImporter: DataImporter = new DataImporter();
  private instances: IFPPInstance[] = [];
  private topologies: IFPPTopology[] = [];
  private components: IFPPComponent[] = [];
  private porttypes: IFPPPortType[] = [];
  private keywords: string[] = ["base_id", "name"];

  /**
   *
   */
  public async loadModel(
      config: IConfig, output?: IOutput): Promise<{ [k: string]: string[] }> {

    // Reset all the model object lists
    this.reset();

    // Invoke the compiler
    const data = await this.dataImporter.invokeCompiler(config, output);
    console.dir(data);

    // Load the model from xml object and return the view list
    if (data == null || data.length === 0) {
      throw new Error("fail to parse model data, model is null!");
    }

    data.forEach((i: any) => {
      this.porttypes = this.porttypes.concat(this.generatePortType(
        i.namespace.port_type,
      ));
    });
    
    data.forEach((i: any) => {
      this.components = this.components.concat(this.generateComponents(
        i.namespace.component,
      ));
    });

    data.forEach((i: any) => {
      if (i.namespace.system == null || i.namespace.system.length === 0) {
        return;
      }

      this.instances = this.instances.concat(this.generateInstances(
        i.namespace.$.name,
        i.namespace.system[0].instance,
      ));
    });

    data.forEach((i: any) => {
      if (i.namespace.system == null || i.namespace.system.length === 0) {
        return;
      }

      this.topologies = this.topologies.concat(this.generateTopologies(
        i.namespace.$.name,
        i.namespace.system[0].topology,
      ));
    });

    // Return the view list of the model
    const viewlist: { [k: string]: string[] } = {
      topologies: [],
      instances: [],
      components: [],
      porttypes: [],
    };
    this.topologies.forEach((e: IFPPTopology) => {
      viewlist.topologies.push(e.name);
    });

    this.instances.forEach((e: IFPPInstance) => {
      viewlist.instances.push(e.name);
    });

    this.components.forEach((e: IFPPComponent) => {
      viewlist.components.push(e.name);
    });

    this.porttypes.forEach((e: IFPPPortType) => {
      viewlist.porttypes.push(e.namespace + "." + e.name);
    })
    console.log(viewlist);
    

    // Add output information
    if (output) {
      output.appendOutput("Generate view list...");
    }
    return viewlist;
  }

  public query(viewName: string, viewType: string): any {
    switch (viewType) {
      case ViewType.Function: {
        const cons: IFPPConnection[] = this.topologies.filter(
          (i) => i.name === viewName)[0].connections;
        let ins: IFPPInstance[] = [];
        cons.forEach((c) => {
          if (ins.indexOf(c.from.inst) === -1) {
            ins.push(Object.assign({}, c.from.inst));
          }
          if (ins.indexOf(c.to.inst) === -1) {
            ins.push(Object.assign({}, c.to.inst));
          }
        });

        ins = this.filterUnusedPorts(ins, cons);
        return {
          instances: ins,
          connections: cons,
          components: [],
        };
      }
      case ViewType.Component: {
        const ins: IFPPInstance[] = [];
        const cons: IFPPConnection[] = [];
        const comps = this.components.filter((i) => i.name === viewName);
        return {
          instances: ins,
          connections: cons,
          components: comps,
        };
      }
      case ViewType.InstanceCentric: {
        let ins: IFPPInstance[] = [];
        const cons: IFPPConnection[] = [];
        const root = this.instances.filter((i) => i.name === viewName)[0];

        this.topologies.forEach((t) => {
          t.connections.forEach((c) => {
            if (c.from.inst === root) {
              ins.push(Object.assign({}, c.to.inst));
              cons.push(c);
            }
            if (c.to.inst === root) {
              ins.push(Object.assign({}, c.from.inst));
              cons.push(c);
            }
          });
        });
        ins.push(Object.assign({}, root));
        ins = this.filterUnusedPorts(ins, cons);
        return {
          instances: ins,
          connections: cons,
          components: [],
        };
      }
      default: {
        return null;
      }
    }
  }

  /**
   * Add a new port type to the current model
   * The default values of the port should includes:
   *  - a default name past by param
   *  - instance number of the port type is 0 
   * @param defaultName default name of the new port type
   */
  public addNewPortType(defaultName: string) {
    const porttype: IFPPPortType = {
      name: defaultName,
      namespace: "undefined",
      arg: {}
    }
    this.porttypes.push(porttype);
  }

  /**
   * Add a new component to the current model.
   * The default values of the component should includes:
   *  - a default name pass by param
   *  - an unspecified namespace
   *  - an empty port array 
   * Then the model should be updated in the source file 
   * in an async way.
   * 
   * @param defaultName default name of the new component
   */
  public addNewComponent(defaultName : string) {
    const item: IFPPComponent[] = [];
    const ps: IFPPPort[] = [];
    item.push({
      name: defaultName,
      namespace: "unspecified",
      ports: ps,
    });

    this.components = this.components.concat(item);
    // TODO: (async) update the model data
  }

  /**
   * Add a new instance to the current model.
   * The instance should created only when the corresponding component exists.
   * The default values of the instance should includes:
   *  - name: @param defaultName
   *  - base_id: defalut should be ? @todo
   *  - ports: the ports array in the component
   *  - 
   * 
   * @param defaultName default name of the new instance
   * @param cpName name of the corresponding component
   */
  public addNewInstance(defaultName : string, cpName: string) {
    const ps: { [p: string]: IFPPPort } = {};
    const type = cpName.split("\.");
      if (type.length !== 2) {
        throw new Error("Invalid type format for [" + cpName + "]");
      }

      const namespace = type[0];
      const name = type[1];
      this.components.forEach((c: IFPPComponent) => {
        if (c.name === namespace + "." + name && c.namespace === namespace) {
          c.ports.forEach((p: IFPPPort) => {
            ps[p.name] = p;
          });
        }
      });
    
    const item: IFPPInstance = {
      name: namespace + "." + defaultName,
      base_id: "-1",
      ports: ps,
      properties: {
        ["type"]: cpName,
        ["namespace"]: namespace,
      }
    };

    this.instances.push(item);
    console.dir(item);
    // TODO: (async) update the model data
  }

  /**
   * Add an empty function view AKA. new topology
   * The default values of the topology should includes:
   *  - a default name pass by param
   *  - an empty connection array 
   * @param defaultName default name of the new function view
   */
  public addNewFunctionView(defaultName : string) {
    const item: IFPPTopology[] = [];
    item.push({
      name: defaultName,
      connections: []
    });

    this.topologies = this.topologies.concat(item);
    // TODO: (async) update the model data
  }

  public deletePortType(name: string) : boolean {
    this.porttypes = this.porttypes.filter((i) => i.name !== name);
    return true;
  }

  /**
   * If you want to delete a component, 
   * you need to cope with all the relevant instance and topology
   * @param name name of the component to delete
   */
  public deleteComponent(name: string) : boolean {
    this.components = this.components.filter((i) => i.name !== name);
    return true;
  }
  
  public deleteInstance(name: string) : boolean {
    this.instances = this.instances.filter((i) => i.name !== name);
    return true;
  }

  public deleteTopology(name: string) : boolean {
    this.topologies = this.topologies.filter((i) => i.name !== name);
    return true;
  }

  public addPortToComponent(portname: string, compname: string): boolean {
    portname = portname.split(".")[1];
    
    let porttype = this.porttypes.find((i) => {
      return i.name === portname;
    });
    let comp = this.components.find((i) => i.name === compname);
    if(porttype == undefined || comp == undefined) return false;
    // existing port
    const newPortname = porttype.name.charAt(0).toLowerCase() + porttype.name.slice(1);
    if(comp.ports.find((i) => i.name === newPortname)) return false;

    const port: IFPPPort = {
      name: newPortname,
      properties: {
        ["direction"]: "in",
        ["kind"]: "",
        ["number"]: 1,
        ["type"]: porttype.namespace + "." + porttype.name,
        ["role"]: "",
      }
    }

    comp.ports.push(port);
    console.dir(comp);
    return true;
  }

  public addInstanceToTopo(instname: string, toponame: string): boolean {
    //
    return false;
  }

  /**
   * Output the model into the selected folder
   */
  public writeToFile(folderPath: string) {
      const tab: string = "    ";

      let dataTypes: { [key: string]: string; } = {};
      // TODO: Data Types
      let portTypes: { [key: string]: string; } = {};
      // TODO: Data Types


      this.components.forEach((e: IFPPComponent) => {
          let componentName = e.name;
          const i = componentName.indexOf(".");
          componentName = componentName.substring(i + 1);
          let componentPath: string = folderPath + "\\" + e.namespace;
          if (!fs.existsSync(componentPath)) {
              fs.mkdirSync(componentPath);
          }
          componentPath += "\\" + componentName + ".fpp";
          let componentContent: string = "";
          // namespace
          componentContent += "namespace " + e.namespace + "\n\n";
          // component name
          componentContent += "component " + componentName + " {\n";
          // TODO: kind

          // ports
          for (const port of e.ports) {
              // get type
              const portType: string = port.properties["type"];
              componentContent += tab + "port " + port.name + ":" + portType + " {\n";
              // port properties
              for (const key in port.properties) {
                  if (key === "type" || key === "name") {
                      continue;
                  }
                  componentContent += tab + tab + key + " = " + port.properties[key] + "\n";
              }
              componentContent += tab + "}\n";
          }
          // closing bracket
          componentContent += "}";
          fs.writeFile(componentPath, componentContent, (err) => {
              if (err) {
                  throw err;
              }
          });
      });

      // key: namespace
      // value: content
      const instanceContent: { [key: string]: string; } = {};
      this.instances.forEach((e: IFPPInstance) => {
          let instanceName: string = e.name;
          const i = instanceName.indexOf(".");
          const instanceNameSpace = instanceName.substring(0, i);
          instanceName = instanceName.substring(i + 1);
          if (!(instanceNameSpace in instanceContent)) {
              instanceContent[instanceNameSpace] = "namespace " + instanceNameSpace + "\n\n";
              instanceContent[instanceNameSpace] += "system sys {\n";
          }
          // get the component type
          const instanceType: string = e.properties["type"];
          // write the instance name first
          instanceContent[instanceNameSpace] += tab + "instance " + instanceName + ":" + instanceType + " {\n";
          // write each instance's properties
          for (const key in e.properties) {
              if (key === "type" || key === "namespace") {
                  continue;
              }
              instanceContent[instanceNameSpace] += tab + tab + key + " = " + e.properties[key] + "\n";
          }
          // closing bracket
          instanceContent[instanceNameSpace] += tab + "}\n";
      });

      // key: namespace
      // value: content
      const topologyContent: { [key: string]: string; } = {};
      this.topologies.forEach((e: IFPPTopology) => {
          let topologyName: string = e.name;
          const i = topologyName.indexOf(".");
          const topologyNameSpace = topologyName.substring(0, i);
          topologyName = topologyName.substring(i + 1);
          if (!(topologyNameSpace in topologyContent)) {
              topologyContent[topologyNameSpace] = "";
          }
          // write the topology name first
          topologyContent[topologyNameSpace] += tab + "topology " + topologyName + " {\n";
          // write each connection
          for (const connection of e.connections) {
              // Get rid of namespace
              let fromInst: string = connection.from.inst.name;
              fromInst = fromInst.substring(fromInst.indexOf(".") + 1);
              let fromPort: string = connection.from.port.name;
              fromPort = fromPort.substring(fromPort.indexOf(".") + 1);
              let toInst: string = connection.to.inst.name;
              toInst = toInst.substring(toInst.indexOf(".") + 1);
              let toPort: string = connection.to.port.name;
              toPort = toPort.substring(toPort.indexOf(".") + 1);

              topologyContent[topologyNameSpace] += tab + tab;
              topologyContent[topologyNameSpace] += fromInst + "." + fromPort;
              topologyContent[topologyNameSpace] += " -> ";
              topologyContent[topologyNameSpace] += toInst + "." + toPort + "\n";
          }
          // closing bracket
          topologyContent[topologyNameSpace] += tab + "}\n";
      });

      // write to file for each namespace
      for (const key in instanceContent) {
          let instancePath: string = folderPath + "\\" + key;
          if (!fs.existsSync(instancePath)) {
              fs.mkdirSync(instancePath);
          }
          instancePath += "\\System.fpp";
          fs.writeFile(instancePath, instanceContent[key] + topologyContent[key] + "}", (err) => {
              if (err) {
                  throw err;
              }
          });
      }
  }

  private reset() {
    this.porttypes = []
    this.instances = [];
    this.topologies = [];
    this.components = [];
  }

  private generatePortType(porttypes: any[]): IFPPPortType[] {
    const res: IFPPPortType[] = [];

    if(porttypes == null || porttypes.length === 0) {
      return res;
    }

    porttypes.forEach((ele: any) => {
      const args : {[p:string]: string} = {} 
      ele.arg.forEach((a: any) => {
        args[a.name] = a.type;
      })
      const pt: IFPPPortType = {
        name: ele.$.name,
        namespace: ele.$.namespace,
        arg: args,
      }
      res.push(pt)
    })

    return res;
  }

  private generateComponents(components: any[]): IFPPComponent[] {
    const res: IFPPComponent[] = [];

    if (components == null || components.length === 0) {
      return res;
    }

    components.forEach((ele: any) => {
      const ps: IFPPPort[] = [];
      ele.port.forEach((port: any) => {
        const p: IFPPPort = {
          name: port.$.name,
          properties: {},
        };

        p.properties = port.$;
        ps.push(p);
      });
      const ns = ele.$.namespace;

      res.push({
        name: ns + "." + ele.$.name,
        namespace: ns,
        ports: ps,
      });
    });

    return res;
  }

  private generateInstances(ns: string, instances: any[]): IFPPInstance[] {
    const res: IFPPInstance[] = [];

    if (instances == null || instances.length === 0) {
      return res;
    }

    instances.forEach((ele: any) => {
      const props: { [p: string]: string } = {};
      for (const key in ele.$) {
        if (!ele.$.hasOwnProperty(key)) {
          continue;
        }
        if (this.keywords.indexOf(key) === -1) {
          props[key] = ele.$[key];
        }
      }
      const ps: { [p: string]: IFPPPort } = {};
      if (ele.$.type === null) {
        throw new Error("The type of element is null.");
      }

      const type = ele.$.type.split("\.");
      if (type.length !== 2) {
        throw new Error("Invalid type format for [" + type + "]");
      }

      const namespace = type[0];
      const name = type[1];
      this.components.forEach((c: IFPPComponent) => {
        if (c.name === namespace + "." + name && c.namespace === namespace) {
          c.ports.forEach((p: IFPPPort) => {
            ps[p.name] = p;
          });
        }
      });

      res.push({
        name:  ns + "." + ele.$.name,
        base_id: ele.$.base_id,
        ports: ps,
        properties: props,
      });
    });

    return res;
  }

  private generateTopologies(ns: string, topologies: any[]): IFPPTopology[] {
    const res: IFPPTopology[] = [];
    if (topologies == null) {
      return res;
    }

    topologies.forEach((ele: any) => {
      const cons: IFPPConnection[] = [];
      ele.connection.forEach((con: any) => {
        const source = this.instances.filter(
          (i) => i.name === ns + "." + con.source[0].$.instance)[0];
        const target = this.instances.filter(
          (i) => i.name === ns + "." + con.target[0].$.instance)[0];


        cons.push({
          from: {
            inst: source,
            port: this.getPortByInstance(source, con.source[0].$.port),
          },
          to: {
            inst: target,
            port: this.getPortByInstance(target, con.target[0].$.port),
          },
        });
      });

      res.push({
        name: ns + "." + ele.$.name,
        connections: cons,
      });
    });

    return res;
  }

  private getPortByInstance(
    ins: IFPPInstance, portName: string): IFPPPort {
    return this.getPortsByInstance(ins)
    .filter((p) => p.name === portName)[0];
  }

  private getPortsByInstance(ins: IFPPInstance): IFPPPort[] {
    const prop: string[] = ins.properties.type.split(".");
    const name: string = prop[1];
    const namespace: string = prop[0];
    const comp = this.components.filter(
      (c) => c.name === namespace + "." + name && c.namespace === namespace,
    )[0];
    return comp.ports;
  }

  private filterUnusedPorts(
    ins: IFPPInstance[], cons: IFPPConnection[],
  ): IFPPInstance[] {
    ins.forEach((i) => {
      const ps: { [k: string]: IFPPPort } = {};
      Object.keys(i.ports).forEach((key) => {
        const p = i.ports[key];
        cons.forEach((c) => {
          if (c.from.port === p) {
            ps[key] = p;
          }
          if (c.to.port === p) {
            ps[key] = p;
          }
        });
      });
      i.ports = ps;
    });
    return ins;
  }
}
