package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
)

const (
	typedResourceConvergencePath = typedServerPrefix + `resource-convergence`
	maxResourceConvergenceTasks  = 100
)

type typedResourceConvergenceRequest struct {
	ResourceID  string `json:"resource_id"`
	ServiceName string `json:"service_name"`
}

type typedResourceConvergenceTask struct {
	State        string `json:"state"`
	DesiredState string `json:"desiredState"`
	Error        string `json:"error,omitempty"`
	ContainerID  string `json:"containerId,omitempty"`
	Health       string `json:"health"`
}

type typedResourceConvergenceResponse struct {
	Tasks []typedResourceConvergenceTask `json:"tasks"`
}

func validateTypedResourceConvergenceRequest(body []byte) (typedResourceConvergenceRequest, error) {
	var input typedResourceConvergenceRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed resource convergence body: %w`, err)
	}
	for field := range fields {
		if field != `resource_id` && field != `service_name` {
			return input, fmt.Errorf(`typed resource convergence does not accept field %q`, field)
		}
	}
	if !resourceIDPattern.MatchString(input.ResourceID) || !swarmNamePattern.MatchString(input.ServiceName) {
		return input, errors.New(`typed resource convergence identity is invalid`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceConvergenceOperation(ctx context.Context, body []byte) (typedResourceConvergenceResponse, error) {
	input, err := validateTypedResourceConvergenceRequest(body)
	if err != nil {
		return typedResourceConvergenceResponse{}, err
	}

	serviceBody, _, err := engine.request(ctx, http.MethodGet, `/services/`+url.PathEscape(input.ServiceName), nil)
	if err != nil {
		return typedResourceConvergenceResponse{}, err
	}
	var service struct {
		Spec struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Spec"`
	}
	if err := json.Unmarshal(serviceBody, &service); err != nil {
		return typedResourceConvergenceResponse{}, fmt.Errorf(`invalid Docker service response: %w`, err)
	}
	if service.Spec.Labels[`com.upstand.resource-id`] != input.ResourceID {
		return typedResourceConvergenceResponse{}, errors.New(`service is not owned by the requested Upstand resource`)
	}

	filters, err := json.Marshal(map[string][]string{
		`service`:       {input.ServiceName},
		`desired-state`: {`running`},
	})
	if err != nil {
		return typedResourceConvergenceResponse{}, err
	}
	tasksBody, _, err := engine.request(ctx, http.MethodGet, `/tasks?filters=`+url.QueryEscape(string(filters)), nil)
	if err != nil {
		return typedResourceConvergenceResponse{}, err
	}
	var tasks []struct {
		DesiredState string `json:"DesiredState"`
		Status       struct {
			State           string `json:"State"`
			Err             string `json:"Err"`
			ContainerStatus struct {
				ContainerID string `json:"ContainerID"`
			} `json:"ContainerStatus"`
		} `json:"Status"`
	}
	if err := json.Unmarshal(tasksBody, &tasks); err != nil {
		return typedResourceConvergenceResponse{}, fmt.Errorf(`invalid Docker task response: %w`, err)
	}
	if len(tasks) > maxResourceConvergenceTasks {
		return typedResourceConvergenceResponse{}, errors.New(`resource convergence returned too many tasks`)
	}

	result := typedResourceConvergenceResponse{Tasks: make([]typedResourceConvergenceTask, 0, len(tasks))}
	for _, task := range tasks {
		state := task.Status.State
		if state == `` {
			state = `unknown`
		}
		desiredState := task.DesiredState
		if desiredState == `` {
			desiredState = `unknown`
		}
		item := typedResourceConvergenceTask{
			State:        state,
			DesiredState: desiredState,
			Error:        task.Status.Err,
			Health:       `none`,
		}
		containerID := task.Status.ContainerStatus.ContainerID
		if containerID != `` {
			if !swarmNodeIDPattern.MatchString(containerID) {
				return typedResourceConvergenceResponse{}, errors.New(`Docker task returned an invalid container ID`)
			}
			item.ContainerID = containerID
			item.Health = `unknown`
			containerBody, status, inspectErr := engine.request(ctx, http.MethodGet, `/containers/`+url.PathEscape(containerID)+`/json`, nil)
			if inspectErr == nil && status >= 200 && status < 300 {
				var container struct {
					Config struct {
						Labels map[string]string `json:"Labels"`
					} `json:"Config"`
					State struct {
						Health struct {
							Status string `json:"Status"`
						} `json:"Health"`
					} `json:"State"`
				}
				if err := json.Unmarshal(containerBody, &container); err != nil {
					return typedResourceConvergenceResponse{}, fmt.Errorf(`invalid Docker container response: %w`, err)
				}
				if container.Config.Labels[`com.upstand.resource-id`] != input.ResourceID {
					return typedResourceConvergenceResponse{}, errors.New(`container is not owned by the requested Upstand resource`)
				}
				if container.State.Health.Status != `` {
					item.Health = container.State.Health.Status
				} else {
					item.Health = `none`
				}
			} else if status != http.StatusNotFound {
				return typedResourceConvergenceResponse{}, inspectErr
			}
		}
		result.Tasks = append(result.Tasks, item)
	}
	return result, nil
}
